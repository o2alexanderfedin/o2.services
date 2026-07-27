/**
 * An `Executor` whose CPU lives on a thread you can kill — BROW-04.
 *
 * The requirement is that one click *provably* drops CPU to zero. On the main
 * thread that is not achievable: `WebAssembly.Instance.exports.run()` is a
 * synchronous call, so a stop signal cannot be delivered until it returns of its
 * own accord. Every cooperative variant — a flag the loop checks, a duty cycle
 * lowered to nothing, a governor asked politely — degrades to "zero soon", and
 * this project has been bitten before by a bound that was documented rather than
 * enforced.
 *
 * `terminate()` calls `Worker.terminate()`. The thread stops mid-instruction, so
 * the claim is a property of the platform rather than of this code behaving.
 *
 * ## What a terminated task costs
 *
 * Nothing that matters. A result is a pure function of (module, input, partition)
 * and is content-addressed, so an abandoned task is at worst wasted work — the
 * invariant Phase 7 rests on. A lease is a deadline rather than a lock, so a node
 * that vanishes mid-task needs no goodbye and the work re-dispatches on its own.
 * That is why a visitor's Stop can be abrupt and still be safe.
 *
 * The worker is created on first use, so a node that is never asked to compute
 * never spawns a thread.
 */

import { decodeCanonical } from '@o2/core'
import type { Blockstore, ExecutionOutcome, Executor, Task } from '@o2/core'
import type { WorkerTaskRequest, WorkerTaskResponse } from './task-executor.worker.ts'

/** Builds the Worker. Injected so this class is testable and bundler-agnostic. */
export type WorkerFactory = () => Worker

export interface WorkerExecutorOptions {
  readonly nodeId: string
  /** Resolves module and input blocks on the main thread, where storage lives. */
  readonly blockstore: Blockstore
  readonly createWorker: WorkerFactory
  readonly maxOutputBytes?: number
}

interface Pending {
  readonly resolve: (outcome: ExecutionOutcome) => void
}

export class WorkerExecutor implements Executor {
  readonly nodeId: string
  readonly #blockstore: Blockstore
  readonly #createWorker: WorkerFactory
  readonly #maxOutputBytes: number | undefined
  readonly #pending = new Map<number, Pending>()
  #worker: Worker | null = null
  #nextId = 0
  #terminated = false
  #started = 0

  constructor(options: WorkerExecutorOptions) {
    this.nodeId = options.nodeId
    this.#blockstore = options.blockstore
    this.#createWorker = options.createWorker
    this.#maxOutputBytes = options.maxOutputBytes
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
    return this.#worker !== null
  }

  #ensureWorker(): Worker {
    const existing = this.#worker
    if (existing !== null) return existing

    const worker = this.#createWorker()
    worker.addEventListener('message', (event: MessageEvent<WorkerTaskResponse>) => {
      const response = event.data
      const waiting = this.#pending.get(response.id)
      if (waiting === undefined) return
      this.#pending.delete(response.id)
      if (!response.ok) {
        waiting.resolve({ ok: false, reason: response.reason })
        return
      }
      try {
        waiting.resolve({
          ok: true,
          output: decodeCanonical(response.outputBytes),
          fuelUsed: response.fuelUsed,
        })
      } catch (cause) {
        waiting.resolve({
          ok: false,
          reason: `worker output did not decode: ${cause instanceof Error ? cause.message : String(cause)}`,
        })
      }
    })
    worker.addEventListener('error', (event: ErrorEvent) => {
      // A thread that died takes every task on it. Failing them individually with
      // the real message beats one global rejection nobody can attribute.
      this.#failAll(`worker error: ${event.message}`)
    })
    this.#worker = worker
    return worker
  }

  #failAll(reason: string): void {
    for (const [, waiting] of this.#pending) waiting.resolve({ ok: false, reason })
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

    const worker = this.#ensureWorker()
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
      this.#pending.set(id, { resolve })
      worker.postMessage(request)
    })
  }

  /**
   * End the thread now.
   *
   * Everything in flight resolves as a failed task rather than hanging, because a
   * caller awaiting a promise that will never settle is a worse outcome than a
   * caller told its work was abandoned. Idempotent.
   */
  terminate(): void {
    this.#terminated = true
    const worker = this.#worker
    this.#worker = null
    if (worker !== null) worker.terminate()
    this.#failAll('executor stopped')
  }
}
