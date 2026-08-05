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
 * **What it costs its co-residents, stated rather than discovered:** one runaway
 * module aborts every task sharing its thread. Each is failed individually with an
 * attributable reason, so nothing is silent, but they are aborted. Closing that means
 * a thread pool or one thread per task, and neither is built here. Re-posting the
 * survivors was considered and rejected: it means retaining every pending task's
 * module and input bytes for its whole deadline window, doubling in-flight memory at
 * up to `DEFAULT_MAX_CONCURRENT_TASKS` tasks, to protect work that `submitJob`'s
 * generation loop already re-dispatches for free. (Until Plan 20-12 this named
 * `runResilient` as the path in question and called it callerless; that module is
 * deleted and the loop is now inside `submitJob`, which four submitters call — so the
 * trade is no longer "protect a path nobody runs" but "pay memory to avoid a
 * re-dispatch", and the answer is still no.)
 *
 * The thread is created on first use, so a node that is never asked to compute never
 * spawns one.
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
}

interface Pending {
  readonly resolve: (outcome: ExecutionOutcome) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export class WorkerExecutor implements Executor {
  readonly nodeId: string
  readonly #blockstore: Blockstore
  readonly #createThread: ComputeThreadFactory
  readonly #maxOutputBytes: number | undefined
  readonly #deadlineMs: number
  readonly #pending = new Map<number, Pending>()
  #thread: ComputeThread | null = null
  #nextId = 0
  #terminated = false
  #started = 0

  constructor(options: WorkerExecutorOptions) {
    this.nodeId = options.nodeId
    this.#blockstore = options.blockstore
    this.#createThread = options.createThread
    this.#maxOutputBytes = options.maxOutputBytes
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_TASK_DEADLINE_MS
  }

  /** Tasks handed to the thread. Observable so the running surface can show it. */
  get started(): number {
    return this.#started
  }

  /** True once `terminate()` has been called. Never returns to false. */
  get terminated(): boolean {
    return this.#terminated
  }

  /** True while a thread exists. False before the first task and after a stop. */
  get threadAlive(): boolean {
    return this.#thread !== null
  }

  #ensureThread(): ComputeThread {
    const existing = this.#thread
    if (existing !== null) return existing

    const thread = this.#createThread()
    thread.onResponse((response) => {
      const waiting = this.#pending.get(response.id)
      if (waiting === undefined) return
      this.#pending.delete(response.id)
      clearTimeout(waiting.timer)
      if (!response.ok) {
        waiting.resolve({ ok: false, reason: response.reason })
        return
      }
      try {
        waiting.resolve({
          ok: true,
          output: decodeCanonical(response.outputBytes),
          fuelUsed: response.fuelUsed,
          // Unsigned by construction — see `WasmExecutor`. This executor holds a thread
          // factory and a deadline, not an identity, and the thread on the other side
          // of `WorkerTaskResponse` holds even less.
          attestation: 'signed-by-nobody',
        })
      } catch (cause) {
        waiting.resolve({
          ok: false,
          reason: `worker output did not decode: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
      }
    })
    thread.onError((reason) => {
      // A thread that died takes every task on it. Failing them individually with
      // the real message beats one global rejection nobody can attribute.
      this.#killThread(`worker error: ${reason}`)
    })
    this.#thread = thread
    return thread
  }

  /**
   * End the current thread and fail everything on it.
   *
   * Deliberately does **not** touch `#terminated`: this is how a deadline and a
   * visitor's Stop differ. `#thread` is cleared, so the next `execute` builds a fresh
   * one and the node goes on computing.
   */
  #killThread(reason: string): void {
    const thread = this.#thread
    this.#thread = null
    if (thread !== null) thread.kill()
    for (const [, waiting] of this.#pending) {
      clearTimeout(waiting.timer)
      waiting.resolve({ ok: false, reason })
    }
    this.#pending.clear()
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

    const thread = this.#ensureThread()
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
      const timer = setTimeout(() => this.#expire(id), this.#deadlineMs)
      this.#pending.set(id, { resolve, timer })
      thread.post(request)
    })
  }

  /** The overrun path: fail the offender by name, then take its thread away. */
  #expire(id: number): void {
    const waiting = this.#pending.get(id)
    if (waiting === undefined) return
    this.#pending.delete(id)
    clearTimeout(waiting.timer)
    // `exec ok:false` at the layer above, never `{kind:'error'}` — `churn.ts` files
    // an error as a NODE condition, and a looping module is a TASK one. Filing it
    // against the node would let one hostile module condemn a healthy peer.
    waiting.resolve({
      ok: false,
      reason: `execution exceeded ${this.#deadlineMs}ms on ${this.nodeId}`,
    })
    this.#killThread(`thread terminated after a task exceeded its deadline on ${this.nodeId}`)
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
    this.#killThread('executor stopped')
  }
}
