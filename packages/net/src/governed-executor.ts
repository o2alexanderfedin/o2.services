/**
 * `GovernedExecutor` — puts the CPU governor on the execution path.
 *
 * `SCHED-04` gave the kernel a `Governor` port, but a port nothing consumes throttles
 * nothing. This is the decorator that spends it: before each task it awaits
 * `yieldSlice()`, so a node running at a 10% duty cycle idles nine units for every
 * one it computes.
 *
 * A decorator rather than a change to `WasmExecutor` because throttling is a policy,
 * not a property of WASM execution — and because it has to compose the same way over
 * a `RemoteExecutor`, where the cost being paced is someone else's.
 *
 * While throttling, execution is **serialized**. That is not a performance choice —
 * shards are dispatched concurrently, so a governor that only awaited `yieldSlice()`
 * per task would see every yield resolve at once and then run the whole job at full
 * speed, silently bypassing the cap. At a duty cycle of 1 the serialization is skipped
 * entirely, so an unthrottled node loses no parallelism.
 *
 * Deliberately yields *between* tasks and never inside one. A WASM call cannot be
 * suspended part-way, so the only place a duty cycle can be applied is at a task
 * boundary. This matters for the browser tier: a backgrounded tab must stop
 * *starting* work, and a task already running must be allowed to finish rather than
 * be abandoned — that is what "resumes without losing its job" requires.
 *
 * Pure module.
 */

import type { ExecutionOutcome, Executor, Governor, Task } from '@o2/core'

export class GovernedExecutor implements Executor {
  readonly #inner: Executor
  readonly #governor: Governor
  /** Tail of the serialization chain, used only while throttling. */
  #tail: Promise<void> = Promise.resolve()
  #executed = 0

  constructor(inner: Executor, governor: Governor) {
    this.#inner = inner
    this.#governor = governor
  }

  get nodeId(): string {
    // The governor is invisible to verification: the same node with a different
    // duty cycle must still be the same node, or throttling would look like a
    // change of identity and break result grouping.
    return this.#inner.nodeId
  }

  /** Tasks started through this executor. */
  get executed(): number {
    return this.#executed
  }

  /** The duty cycle currently in force. Reflects live changes. */
  get dutyCycle(): number {
    return this.#governor.dutyCycle
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    // Unthrottled: straight through, fully concurrent. A node at full rate must pay
    // nothing for the governor's existence — neither a sleep nor a loss of
    // parallelism.
    if (this.#governor.dutyCycle >= 1) {
      this.#executed += 1
      return this.#inner.execute(task)
    }

    // Throttled: serialize.
    //
    // This is not an optimisation, it is the whole meaning of a duty cycle. Shards
    // are dispatched concurrently — `submitJob` runs them under `Promise.all` — so a
    // governor that merely awaited `yieldSlice()` per task would have every yield
    // resolve at once and then run the entire job at full speed. The cap would be
    // silently bypassed by concurrency. Pacing only exists if the node computes one
    // slice at a time with the idle gap in between.
    const previous = this.#tail
    const gate: { release: () => void } = { release: () => {} }
    this.#tail = new Promise<void>((resolve) => {
      gate.release = resolve
    })

    try {
      await previous
      await this.#governor.yieldSlice()
      this.#executed += 1
      return await this.#inner.execute(task)
    } finally {
      // Always release, or one failed task stalls every later one forever.
      gate.release()
    }
  }
}
