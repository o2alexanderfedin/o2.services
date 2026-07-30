/**
 * `CountingExecutor` — the instrument a node's execution concurrency is read off.
 *
 * A pass-through `Executor`: it delegates `nodeId` and `execute` to an inner
 * executor, counts entries into `execute`, decrements in a `finally`, and keeps
 * the high-water mark.
 *
 * ## What it is for
 *
 * SCHED-06's criterion 1 asks for the peak number of simultaneous
 * `executor.execute()` calls on a node under concurrent dispatch. That number
 * cannot be inferred from replies — a node that refused everything and a node
 * that ran everything one at a time produce reply sets a caller cannot tell
 * apart — and a `FabricNode`'s internal executor is not reachable from outside
 * the factory by design. Composing this around the executor the node serves puts
 * the count where the calls are.
 *
 * ## What it is **not** — this is the trap
 *
 * It is a *different* instrument from `LocalCapacity.peakInFlight`, and the two
 * must not be substituted for one another:
 *
 * - `LocalCapacity.peakInFlight` counts *slots held*. It is bounded by `slots` by
 *   construction — the refusal returns before the reservation is taken — so it
 *   can say the limit was reached and can **never** say the limit was exceeded.
 *   Asserting `peakInFlight <= slots` proves nothing; it is arithmetic.
 * - This counter counts `execute()` calls that actually happened. It can read any
 *   number at all, which is what makes an assertion about it falsifiable. Under a
 *   mutation that removes the slot acquisition it jumps to the dispatched request
 *   count, which is exactly the roadmap's measured defect reproduced inside the
 *   suite.
 *
 * It counts **every** call on the executor it wraps, including a local caller
 * reaching `node.executor` directly — which takes no admission slot, because
 * admission lives on `serveAgent`'s exec branch and a local call never reaches
 * it. So `peakInFlight <= slots` is a claim only about a run in which every
 * dispatch arrived over RPC, and any test asserting it must say so.
 *
 * ## Production call site
 *
 * Plan 13.1-05 Task 1 composes it as the outermost wrapper of the executor in
 * both `fabric-node.ts` and `browser-node.ts` and exposes its readings on the
 * node. It is created and used here so the mechanism is proven before it is
 * wired; a mechanism whose only caller is a test is the pattern this milestone
 * exists to remove.
 *
 * Pure module.
 */

import type { ExecutionOutcome, Executor, Task } from '@o2/core'

export class CountingExecutor implements Executor {
  readonly #inner: Executor
  #inFlight = 0
  #peak = 0

  constructor(inner: Executor) {
    this.#inner = inner
  }

  get nodeId(): string {
    // The instrument is invisible to verification: the same node measured is
    // still the same node, or wrapping it would look like a change of identity
    // and break result grouping.
    return this.#inner.nodeId
  }

  /** Calls currently inside `execute`. */
  get inFlight(): number {
    return this.#inFlight
  }

  /**
   * The most calls ever inside `execute` at one instant.
   *
   * Never decreases, for the same reason `LocalCapacity.peakInFlight` does not: a
   * high-water mark that could fall would answer "was this node ever saturated?"
   * with whatever happened to be true at the moment somebody read it.
   */
  get peakInFlight(): number {
    return this.#peak
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    this.#inFlight += 1
    if (this.#inFlight > this.#peak) this.#peak = this.#inFlight
    try {
      return await this.#inner.execute(task)
    } finally {
      // A throwing inner executor must not leave the count raised, or every later
      // reading is wrong by however many tasks have failed.
      this.#inFlight -= 1
    }
  }
}
