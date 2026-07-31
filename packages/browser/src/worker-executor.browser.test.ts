import { MemoryBlockstore } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { browserWorkerExecutor } from './worker-executor.ts'
import { PROBE_EMITS_TEN, PROBE_NEVER_RETURNS } from './wasm-probes.ts'
// Vite's `?worker` suffix bundles the module and its imports into a real Worker.
// Browser project only — see vitest.config.ts.
import TaskExecutorWorker from './task-executor.worker.ts?worker'

/**
 * BROW-04 — "a visitor can see what the node is doing and stop it at any time",
 * and the clause this file exists for: *one click provably drops CPU to zero*.
 *
 * These run against a genuine `Worker`. A fake one resolves on a microtask and is
 * therefore faster than the thing it stands in for, which in this project has
 * already hidden a hang, an unexamined disagreement, and an allocation spin. The
 * spin probe here cannot be faked at all: nothing but killing the thread ends it.
 *
 * ## Two budgets per case, and their order is the rule
 *
 * Every case here arms two timers: the executor's own `deadlineMs`, and vitest's
 * `testTimeout` (the trailing argument to `it`). **The framework's must be the larger
 * one.** Inverted, the executor's timer can never be the one that fires, so a case
 * that means to observe a deadline — or to be immune to one — instead dies with
 * `Test timed out`, which names nothing and asserts nothing.
 *
 * That inversion was live here on 2026-07-31: four cases paired `deadlineMs: 60_000`
 * with `}, 30_000)`. It surfaced only when an unrelated LLVM build pushed this host to
 * a load average of 130 on 8 cores and the work stopped fitting inside 30 s. The pair
 * at the foot of the file had it right all along — a 30 s deadline inside a 60 s
 * framework budget — and the four now follow it at 60 s inside 120 s.
 *
 * `tools/aot/lift.node.test.ts` carries the same rule and the same scars; its header
 * records the measurement behind its numbers.
 */

const CANONICAL_INPUT = new Uint8Array([0x0a]) as Uint8Array<ArrayBuffer>

async function seeded(module: Uint8Array<ArrayBuffer>): Promise<{
  store: MemoryBlockstore
  moduleCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  inputCid: Awaited<ReturnType<MemoryBlockstore['put']>>
}> {
  const store = new MemoryBlockstore()
  return { store, moduleCid: await store.put(module), inputCid: await store.put(CANONICAL_INPUT) }
}

describe('the probes are real WASM, not bytes we merely believe in', () => {
  it('validates both modules before anything relies on them', () => {
    // Hand-assembled bytes are only trustworthy because the engine agrees.
    expect(WebAssembly.validate(PROBE_EMITS_TEN)).toBe(true)
    expect(WebAssembly.validate(PROBE_NEVER_RETURNS)).toBe(true)
  })
})

describe('a task executes off the main thread', () => {
  it('returns the guest output decoded from canonical bytes', async () => {
    const { store, moduleCid, inputCid } = await seeded(PROBE_EMITS_TEN)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => new TaskExecutorWorker(),
      // Explicit, and generous, because this test is not about the deadline.
      //
      // Left to the default it inherits `DEFAULT_TASK_DEADLINE_MS` (10 s), which
      // turns "does the guest's output decode" into a measurement of how busy the
      // machine is. Observed: with an unrelated LLVM build saturating the host —
      // load average 31 on 8 cores — a guest that emits a single integer took over
      // 10 s of wall clock, the bound fired exactly as designed, and this assertion
      // read `expected false to be true` in Chromium and WebKit. The bound was
      // right and the test was wrong to depend on it.
      //
      // The tests that ARE about the deadline set it deliberately short (600 ms,
      // below) and must keep doing so. This one wants the opposite.
      deadlineMs: 60_000,
    })
    try {
      const outcome = await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.output).toBe(10)
      expect(executor.started).toBe(1)
      expect(executor.threadAlive).toBe(true)
    } finally {
      executor.terminate()
    }
  }, 120_000)

  it('spawns no thread until it is actually asked to compute', async () => {
    const { store } = await seeded(PROBE_EMITS_TEN)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => new TaskExecutorWorker(),
    })
    expect(executor.threadAlive).toBe(false)
    executor.terminate()
  })

  it('reports a missing block rather than starting a thread for work it cannot do', async () => {
    const { store, moduleCid } = await seeded(PROBE_EMITS_TEN)
    const absent = await new MemoryBlockstore().put(new Uint8Array([0xff]) as Uint8Array<ArrayBuffer>)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => new TaskExecutorWorker(),
    })
    const outcome = await executor.execute({
      moduleCid,
      inputCid: absent,
      partitionIndex: 0,
      partitionCount: 1,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('input block missing')
    expect(executor.threadAlive).toBe(false)
    executor.terminate()
  }, 30_000)
})

describe('stopping is termination, not a request to stop', () => {
  it('ends a task that would otherwise never end', async () => {
    // The whole claim in one test. `PROBE_NEVER_RETURNS` is a bare `loop br 0`:
    // no flag, no duty cycle and no governor can reach it, because the guest never
    // yields. If this resolves, the thread was killed.
    const { store, moduleCid, inputCid } = await seeded(PROBE_NEVER_RETURNS)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => new TaskExecutorWorker(),
      // Long, deliberately: this case is about Stop, and a deadline firing first
      // would make it pass for the wrong reason. The deadline has its own case below.
      deadlineMs: 60_000,
    })

    const running = executor.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    // Let the worker actually enter the loop before killing it, so this is a
    // termination mid-execution rather than a race with startup.
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(executor.threadAlive).toBe(true)

    executor.terminate()

    const outcome = await running
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('executor stopped')
    expect(executor.threadAlive).toBe(false)
    expect(executor.terminated).toBe(true)
  }, 120_000)

  it('leaves the main thread responsive throughout', async () => {
    // If execution were on the main thread, the spin would block this timer and
    // the assertion below would never run. That it does run is the off-main-thread
    // claim, observed rather than asserted.
    const { store, moduleCid, inputCid } = await seeded(PROBE_NEVER_RETURNS)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => new TaskExecutorWorker(),
      // Same reason as above: the subject is the main thread staying responsive, not
      // the deadline, so the deadline is put out of reach of this window.
      deadlineMs: 60_000,
    })
    const running = executor.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })

    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
    }, 10)
    await new Promise((resolve) => setTimeout(resolve, 300))
    clearInterval(timer)
    expect(ticks).toBeGreaterThan(5)

    executor.terminate()
    await running
  }, 120_000)

  it('really ends the thread, not merely the promise waiting on it', async () => {
    // The trap this test exists to close: rejecting every pending promise makes a
    // stop *look* instant while the thread keeps burning. Resolving the caller and
    // killing the worker are two different acts, and only one of them is the
    // requirement. So this asks the thread itself, directly, past the executor.
    const { store, moduleCid, inputCid } = await seeded(PROBE_EMITS_TEN)
    const workers: Worker[] = []
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => {
        const worker = new TaskExecutorWorker()
        workers.push(worker)
        return worker
      },
      // Generous for the same reason as the decode test above: this asks whether
      // `terminate` really kills the thread, and a starved machine tripping the
      // default 10 s bound first would replace the thread before the question is
      // put.
      deadlineMs: 60_000,
    })

    await executor.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    const worker = workers[0]
    expect(worker).toBeDefined()
    if (worker === undefined) return

    const asksAndWaits = async (id: number): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1_000)
        worker.addEventListener('message', () => {
          clearTimeout(timer)
          resolve(true)
        })
        worker.postMessage({
          id,
          moduleBytes: PROBE_EMITS_TEN,
          inputBytes: CANONICAL_INPUT,
          partitionIndex: 0,
          partitionCount: 1,
        })
      })

    // Positive control first, so a "no reply" below cannot be a slow thread or a
    // one-second window that was never long enough.
    expect(await asksAndWaits(101)).toBe(true)

    executor.terminate()

    // `postMessage` to a terminated worker is a no-op and no message event ever
    // fires again. A thread that is merely idle would still answer this.
    expect(await asksAndWaits(102)).toBe(false)
  }, 120_000)

  it('refuses further work once stopped, and stays stopped', async () => {
    const { store, moduleCid, inputCid } = await seeded(PROBE_EMITS_TEN)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: store,
      createWorker: () => new TaskExecutorWorker(),
    })
    executor.terminate()
    executor.terminate() // idempotent

    const outcome = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('executor stopped')
    expect(executor.threadAlive).toBe(false)
    expect(executor.started).toBe(0)
  }, 30_000)
})

describe('BROW-04 / SCHED-06 — a runaway guest is killed by the deadline, not only by Stop', () => {
  it('fails a real spinning guest on time and computes again on the replacement thread', async () => {
    // A fake thread cannot prove this. `PROBE_NEVER_RETURNS` is a bare `loop br 0`
    // in a real Worker: no flag, no duty cycle, no governor and no timer inside that
    // thread can reach it, because the guest never yields. If the first outcome
    // arrives at all, the thread was killed — and if the second one succeeds, the
    // executor built a new one rather than retiring itself.
    const deadlineMs = 600
    const spinning = await seeded(PROBE_NEVER_RETURNS)
    const executor = browserWorkerExecutor({
      nodeId: 'tab',
      blockstore: spinning.store,
      createWorker: () => new TaskExecutorWorker(),
      deadlineMs,
    })

    try {
      const started = performance.now()
      const outcome = await executor.execute({
        moduleCid: spinning.moduleCid,
        inputCid: spinning.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })
      const elapsed = performance.now() - started

      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toMatch(/exceeded \d+ms/)
      expect(elapsed).toBeLessThan(deadlineMs * 8)
      // Stop was never pressed, so the node is still willing to work.
      expect(executor.terminated).toBe(false)

      const ordinary = await seeded(PROBE_EMITS_TEN)
      const next = await browserWorkerExecutor({
        nodeId: 'tab',
        blockstore: ordinary.store,
        createWorker: () => new TaskExecutorWorker(),
        deadlineMs: 30_000,
      }).execute({
        moduleCid: ordinary.moduleCid,
        inputCid: ordinary.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      expect(next.output).toBe(10)
    } finally {
      executor.terminate()
    }
  }, 60_000)
})
