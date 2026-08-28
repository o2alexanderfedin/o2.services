/**
 * An `Executor` whose CPU lives on a thread you can kill — BROW-04, SCHED-06.
 *
 * Two requirements meet here and one mechanism satisfies both, because they are the
 * same fact asked twice: **a guest `run()` cannot be interrupted from the thread
 * running it.** It is a synchronous call, V8 exposes no fuel metering, and every
 * cooperative variant — a flag the loop checks, a duty cycle lowered to nothing, a
 * governor asked politely — degrades to "zero soon". Ending the thread is the only
 * mechanism that exists.
 *
 * From that one fact:
 *
 * - **A visitor's Stop drops CPU to zero.** `terminate()` kills the thread, so the
 *   claim is a property of the platform rather than of this code behaving.
 * - **A peer's module cannot hold this node.** {@link WorkerExecutor.execute} arms a
 *   wall-clock deadline per task and kills the thread when it expires. Without it a
 *   52-byte looping module wedged an unauthenticated node outright — the admission
 *   slot's `finally` sat around an `await` that never settled, and the RPC timeout's
 *   own `setTimeout` could not fire either.
 *
 * The two are deliberately **not** the same state. Stop is the visitor retiring the
 * node and latches; a deadline is one bounded incident and does not, or one hostile
 * module would permanently disable the tab's compute and the fix would be a worse
 * denial of service than the bug.
 *
 * ## What a killed task costs
 *
 * Nothing that matters to correctness. A result is a pure function of (module, input,
 * partition) and is content-addressed, so an abandoned task is at worst wasted work —
 * the invariant Phase 7 rests on. A lease is a deadline rather than a lock, so a node
 * that vanishes mid-task needs no goodbye and the work re-dispatches on its own.
 *
 * **A runaway takes nothing but itself.** This paragraph said the opposite until
 * 2026-08-28: *"one runaway module aborts every task sharing its thread… closing that
 * means a thread pool or one thread per task, and neither is built here."* Both are
 * built now, and they are the same thing — **a task holds a thread alone**, so there
 * are no co-residents to abort. Work above the bound waits in a queue this class owns
 * instead of in the worker's message queue, where it was invisible and where its
 * deadline ran against a wait nobody could see.
 *
 * ## The pool, and what its size is a statement about
 *
 * {@link WorkerExecutorOptions.maxThreads} defaults to {@link hostCoreCount} — the
 * host's own answer, read lazily, never a typed-in number. That is the whole of "run as
 * many tasks at once as this machine has cores": above the bound, tasks queue.
 *
 * **This is not `LocalCapacity`'s `maxConcurrent`, and the two must not be reconciled.**
 * That one is an *admission* bound on work peers send this node, defaulting to 64, and
 * `placement.ts` records why it is deliberately not a core count: admission refusal has
 * no re-pick behind it on the production submit path, so lowering it to a core count
 * would turn slow jobs into failed ones. Admission answers *"will I accept this?"*; the
 * pool answers *"how many can actually run?"*. A node may hold 64 accepted tasks and run
 * eight.
 *
 * **What a thread's death costs, now that it costs less.** Killing a thread fails the
 * one task on it. Anything queued behind that task is untouched and is dispatched to
 * the next free thread. Re-posting is therefore not a question this class has to answer
 * any more — the earlier rejection of it (retaining every pending task's bytes for its
 * whole deadline window, to protect work `submitJob` re-dispatches for free) is moot,
 * because nothing but the offender is lost.
 *
 * Threads are created on demand and never eagerly, so a node that is never asked to
 * compute spawns none, and a node asked for one task spawns one rather than a poolful.
 */

import { decodeCanonical } from '../canonical/encode.ts'
import type {
  Blockstore,
  ComputeThread,
  ComputeThreadFactory,
  ExecutionOutcome,
  Executor,
  Task,
} from '../ports.ts'
import { hostCoreCount } from './core-count.ts'
import type { WorkerTaskRequest } from './task-run.ts'

/**
 * How long one task may hold its thread.
 *
 * Bounded on both sides, and both bounds are reasons rather than taste. It must sit
 * **strictly below** `DEFAULT_RPC_TIMEOUT_MS` (30_000, `@o2/net`) so a requestor is
 * told a named reason instead of sitting out its whole budget — NET-10's argument
 * applied to time; that relation is asserted by test rather than left as a comment.
 * And it must sit far enough above ordinary per-task latency that a backgrounded
 * tab's duty cycle cannot trip it.
 */
export const DEFAULT_TASK_DEADLINE_MS = 10_000

export interface WorkerExecutorOptions {
  readonly nodeId: string
  /** Resolves module and input blocks on the calling thread, where storage lives. */
  readonly blockstore: Blockstore
  readonly createThread: ComputeThreadFactory
  readonly maxOutputBytes?: number
  readonly deadlineMs?: number
  /**
   * Tasks that may run at once. Defaults to {@link hostCoreCount}.
   *
   * An option rather than only a reading, for the reason `maxConcurrentTasks` is one on
   * both node factories: a spec that wants to observe the bound has to be able to set
   * it, and a bound sized by whatever machine ran the suite is not a bound anything can
   * assert against. `packages/node` may also pass `os.cpus().length` here if it wants
   * the OS figure rather than the runtime's.
   */
  readonly maxThreads?: number
}

interface Pending {
  readonly resolve: (outcome: ExecutionOutcome) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** A task that has a deadline running but no thread yet. */
interface Queued {
  readonly id: number
  readonly request: WorkerTaskRequest
}

export class WorkerExecutor implements Executor {
  readonly nodeId: string
  readonly #blockstore: Blockstore
  readonly #createThread: ComputeThreadFactory
  readonly #maxOutputBytes: number | undefined
  readonly #deadlineMs: number
  readonly #maxThreads: number
  readonly #pending = new Map<number, Pending>()
  /** Every thread this executor is responsible for. Its size IS the thread count. */
  readonly #live = new Set<ComputeThread>()
  /** Live threads holding no task. Popped before a new one is built. */
  readonly #idle: ComputeThread[] = []
  /** Task id → the thread running it. One entry per busy thread, by construction. */
  readonly #running = new Map<number, ComputeThread>()
  /** Accepted, deadline armed, waiting for a thread. FIFO. */
  readonly #queue: Queued[] = []
  #nextId = 0
  #terminated = false
  #started = 0

  constructor(options: WorkerExecutorOptions) {
    const maxThreads = options.maxThreads ?? hostCoreCount()
    // The same guard `LocalCapacity` puts on `maxConcurrent`, and the same reason: a
    // pool of zero refuses everything, which is a node that has left rather than a node
    // going slowly. Thrown at construction so the bad value never reaches a dispatch.
    if (!Number.isInteger(maxThreads) || maxThreads < 1) {
      throw new RangeError(`maxThreads must be a positive integer, got ${maxThreads}`)
    }
    this.nodeId = options.nodeId
    this.#blockstore = options.blockstore
    this.#createThread = options.createThread
    this.#maxOutputBytes = options.maxOutputBytes
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_TASK_DEADLINE_MS
    this.#maxThreads = maxThreads
  }

  /** The pool's bound — the host's core count unless the caller said otherwise. */
  get maxThreads(): number {
    return this.#maxThreads
  }

  /** Threads that exist right now: at most {@link maxThreads}, zero before first use. */
  get threadCount(): number {
    return this.#live.size
  }

  /** Accepted tasks with a deadline running and no thread yet. */
  get queued(): number {
    return this.#queue.length
  }

  /** Tasks handed to the thread. Observable so the running surface can show it. */
  get started(): number {
    return this.#started
  }

  /** True once `terminate()` has been called. Never returns to false. */
  get terminated(): boolean {
    return this.#terminated
  }

  /** True while any thread exists. False before the first task and after a stop. */
  get threadAlive(): boolean {
    return this.#live.size > 0
  }

  /** Settle one accepted task and retire its deadline. A no-op if it already settled. */
  #settle(id: number, outcome: ExecutionOutcome): void {
    const waiting = this.#pending.get(id)
    if (waiting === undefined) return
    this.#pending.delete(id)
    clearTimeout(waiting.timer)
    waiting.resolve(outcome)
  }

  #buildThread(): ComputeThread {
    const thread = this.#createThread()
    thread.onResponse((response) => this.#receive(thread, response))
    // A thread that died takes the one task on it. Failing that task by name beats a
    // global rejection nobody can attribute — and, since the pool gives it no
    // thread-mates, nothing else is touched.
    thread.onError((reason) => this.#discardThread(thread, `worker error: ${reason}`))
    this.#live.add(thread)
    return thread
  }

  #receive(thread: ComputeThread, response: Parameters<Parameters<ComputeThread['onResponse']>[0]>[0]): void {
    // Only free the thread if this response is the task it is actually holding. A late
    // answer for a task already expired must not hand back a thread that was discarded
    // with it, which would put a killed thread into the idle list.
    if (this.#running.get(response.id) === thread) {
      this.#running.delete(response.id)
      if (this.#live.has(thread)) this.#idle.push(thread)
    }
    if (!response.ok) {
      this.#settle(response.id, { ok: false, reason: response.reason })
    } else {
      try {
        this.#settle(response.id, {
          ok: true,
          output: decodeCanonical(response.outputBytes),
          fuelUsed: response.fuelUsed,
          // Unsigned by construction — see `WasmExecutor`. This executor holds a thread
          // factory and a deadline, not an identity, and the thread on the other side
          // of `WorkerTaskResponse` holds even less.
          attestation: 'signed-by-nobody',
        })
      } catch (cause) {
        this.#settle(response.id, {
          ok: false,
          reason: `worker output did not decode: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
      }
    }
    this.#drain()
  }

  /**
   * End one thread and fail the task on it.
   *
   * Deliberately does **not** touch `#terminated`: this is how a deadline and a
   * visitor's Stop differ. The thread leaves the pool, so the next dispatch builds a
   * fresh one and the node goes on computing. Idempotent — a thread already gone is
   * not killed twice, which is what keeps {@link threadCount} from drifting negative
   * when an error and a deadline land on the same thread.
   */
  #discardThread(thread: ComputeThread, reason: string): void {
    if (!this.#live.delete(thread)) return
    const idleAt = this.#idle.indexOf(thread)
    if (idleAt >= 0) this.#idle.splice(idleAt, 1)
    thread.kill()
    for (const [id, holder] of [...this.#running]) {
      if (holder !== thread) continue
      this.#running.delete(id)
      this.#settle(id, { ok: false, reason })
    }
    this.#drain()
  }

  /** An idle thread, a new one if the pool has room, or nothing. */
  #takeThread(): ComputeThread | null {
    const idle = this.#idle.pop()
    if (idle !== undefined) return idle
    if (this.#live.size >= this.#maxThreads) return null
    return this.#buildThread()
  }

  /** Give the head of the queue a thread, for as long as both exist. */
  #drain(): void {
    if (this.#terminated) return
    while (this.#queue.length > 0) {
      const thread = this.#takeThread()
      if (thread === null) return
      // Shifted only once a thread is in hand, so a full pool leaves the queue exactly
      // as it was rather than losing its head.
      const next = this.#queue.shift() as Queued
      this.#running.set(next.id, thread)
      thread.post(next.request)
    }
  }

  /** Run it now if the pool has room, otherwise put it in line. */
  #dispatch(id: number, request: WorkerTaskRequest): void {
    const thread = this.#takeThread()
    if (thread === null) {
      this.#queue.push({ id, request })
      return
    }
    this.#running.set(id, thread)
    thread.post(request)
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    if (this.#terminated) return { ok: false, reason: 'executor stopped' }

    const moduleBytes = await this.#blockstore.get(task.moduleCid)
    if (moduleBytes === undefined) {
      return { ok: false, reason: `module block missing: ${task.moduleCid.toString()}` }
    }
    const inputBytes = await this.#blockstore.get(task.inputCid)
    if (inputBytes === undefined) {
      return { ok: false, reason: `input block missing: ${task.inputCid.toString()}` }
    }

    // Re-checked after the awaits: a stop that lands while blocks are being fetched
    // must not then start a thread. Without this, Stop during a slow IndexedDB read
    // spawns exactly the thread it was pressed to prevent.
    if (this.#terminated) return { ok: false, reason: 'executor stopped' }

    const id = this.#nextId++
    this.#started += 1

    const request: WorkerTaskRequest = {
      id,
      moduleBytes,
      inputBytes,
      partitionIndex: task.partitionIndex,
      partitionCount: task.partitionCount,
      ...(this.#maxOutputBytes === undefined ? {} : { maxOutputBytes: this.#maxOutputBytes }),
    }

    return new Promise<ExecutionOutcome>((resolve) => {
      // The entry and its deadline are created in one statement, so "a pending task
      // with no deadline" is not a constructible state.
      //
      // **The clock starts here, at submission, and covers the queue wait.** That is
      // deliberate and is the reason the deadline sits strictly below
      // `DEFAULT_RPC_TIMEOUT_MS`: a requestor must be told a named reason rather than
      // sit out its whole budget. A clock started at dispatch-to-thread would let a
      // queued task overrun that budget with nothing to report — NET-10's argument
      // applied to time.
      const timer = setTimeout(() => this.#expire(id), this.#deadlineMs)
      this.#pending.set(id, { resolve, timer })
      this.#dispatch(id, request)
    })
  }

  /**
   * The overrun path, and it forks on whether the task ever got a thread.
   *
   * A **running** task overran because its guest will not come back, so its thread is
   * taken away — that is the only mechanism that ends a synchronous WASM call. A
   * **queued** task overran because the machine was busy, and killing a thread for it
   * would punish whichever task happened to be holding one.
   */
  #expire(id: number): void {
    if (!this.#pending.has(id)) return
    // `exec ok:false` at the layer above, never `{kind:'error'}` — `churn.ts` files
    // an error as a NODE condition, and a looping module is a TASK one. Filing it
    // against the node would let one hostile module condemn a healthy peer. The same
    // reason serves both arms: a queue that was too long is not a bad node either.
    const reason = `execution exceeded ${this.#deadlineMs}ms on ${this.nodeId}`

    const thread = this.#running.get(id)
    if (thread === undefined) {
      const at = this.#queue.findIndex((entry) => entry.id === id)
      if (at >= 0) this.#queue.splice(at, 1)
      this.#settle(id, { ok: false, reason })
      return
    }

    this.#running.delete(id)
    this.#settle(id, { ok: false, reason })
    this.#discardThread(
      thread,
      `thread terminated after a task exceeded its deadline on ${this.nodeId}`,
    )
  }

  /**
   * End the thread now, and stop taking work.
   *
   * Everything in flight resolves as a failed task rather than hanging, because a
   * caller awaiting a promise that will never settle is a worse outcome than a
   * caller told its work was abandoned. Idempotent.
   */
  terminate(): void {
    this.#terminated = true
    // `#terminated` first, so `#discardThread`'s `#drain()` cannot hand a thread to a
    // queued task on the way out. The queue is emptied before anything is settled for
    // the same reason: BROW-04 says Stop drops CPU to zero, and a pool must not turn
    // that into "zero on the threads it happened to remember".
    this.#queue.length = 0
    for (const thread of [...this.#live]) this.#discardThread(thread, 'executor stopped')
    this.#idle.length = 0
    this.#running.clear()
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id, { ok: false, reason: 'executor stopped' })
    }
  }
}
