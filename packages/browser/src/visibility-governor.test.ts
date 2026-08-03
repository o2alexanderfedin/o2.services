import { MemoryBlockstore, publicNodes, submitJob } from '@o2/core'
import type { Executor, Task } from '@o2/core'
import { GovernedExecutor } from '@o2/net'
import { describe, expect, it } from 'vitest'
import { VisibilityGovernor } from './visibility-governor.ts'
import type { VisibilitySource } from './visibility-governor.ts'

/**
 * BROW-03 governor logic, without a real tab.
 *
 * The visibility source is injected, so the state machine is verified
 * deterministically here and the Playwright test only has to confirm that a real
 * `visibilitychange` drives it. Splitting it that way keeps the flaky-by-nature part
 * of the suite as small as possible.
 */

/** A `document`-shaped stub whose visibility the test controls. */
class FakeVisibility implements VisibilitySource {
  hidden = false
  readonly #listeners = new Set<() => void>()

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.#listeners.add(listener)
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.#listeners.delete(listener)
  }

  set(hidden: boolean): void {
    this.hidden = hidden
    for (const listener of [...this.#listeners]) listener()
  }

  get listenerCount(): number {
    return this.#listeners.size
  }
}

/** Records requested sleeps instead of performing them. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    sleep: async (ms) => {
      calls.push(ms)
    },
  }
}

describe('BROW-03 — VisibilityGovernor', () => {
  it('runs unthrottled while visible and costs nothing', async () => {
    const visibility = new FakeVisibility()
    const { sleep, calls } = recordingSleep()
    const governor = new VisibilityGovernor({ visibility, sleep })

    expect(governor.hidden).toBe(false)
    expect(governor.dutyCycle).toBe(1)

    await governor.yieldSlice()
    // At a duty cycle of 1 the governor must not sleep at all, so an unthrottled
    // node pays nothing for its existence.
    expect(calls).toEqual([])
    expect(governor.sleptMs).toBe(0)
  })

  it('throttles as soon as the tab is hidden', async () => {
    const visibility = new FakeVisibility()
    const { sleep, calls } = recordingSleep()
    const governor = new VisibilityGovernor({
      visibility,
      sleep,
      backgroundDutyCycle: 0.1,
      sliceMs: 50,
    })

    visibility.set(true)

    expect(governor.hidden).toBe(true)
    expect(governor.dutyCycle).toBe(0.1)
    expect(governor.transitions).toBe(1)

    await governor.yieldSlice()
    // 50ms of compute at 10% duty means 450ms idle.
    expect(calls).toEqual([450])
    expect(governor.sleptMs).toBeCloseTo(450, 6)
  })

  it('restores the full rate on return', async () => {
    const visibility = new FakeVisibility()
    const { sleep, calls } = recordingSleep()
    const governor = new VisibilityGovernor({ visibility, sleep, backgroundDutyCycle: 0.25 })

    visibility.set(true)
    await governor.yieldSlice()
    visibility.set(false)
    await governor.yieldSlice()

    expect(governor.dutyCycle).toBe(1)
    expect(governor.transitions).toBe(2)
    // One sleep while hidden, none after returning.
    expect(calls).toHaveLength(1)
  })

  it('ignores a change event that does not change visibility', () => {
    const visibility = new FakeVisibility()
    const governor = new VisibilityGovernor({ visibility })
    visibility.set(false) // already visible
    expect(governor.transitions).toBe(0)
    expect(governor.lastChangeAt).toBeNull()
  })

  it('never throttles all the way to zero', () => {
    // Zero would abandon in-flight work rather than pace it.
    const visibility = new FakeVisibility()
    expect(() => new VisibilityGovernor({ visibility, backgroundDutyCycle: 0 })).toThrow(RangeError)
    expect(() => new VisibilityGovernor({ visibility, foregroundDutyCycle: 1.5 })).toThrow(RangeError)
  })

  it('detaches its listener on stop', () => {
    const visibility = new FakeVisibility()
    const governor = new VisibilityGovernor({ visibility })
    expect(visibility.listenerCount).toBe(1)
    governor.stop()
    expect(visibility.listenerCount).toBe(0)
  })

  it('starts hidden if the tab already is', () => {
    const visibility = new FakeVisibility()
    visibility.hidden = true
    const governor = new VisibilityGovernor({ visibility, backgroundDutyCycle: 0.2 })
    // A node created in a background tab must not begin at full rate.
    expect(governor.hidden).toBe(true)
    expect(governor.dutyCycle).toBe(0.2)
  })
})

describe('BROW-03 — a job spanning a visibility change', () => {
  it('completes every shard, and pays the idle cost only while hidden', async () => {
    const visibility = new FakeVisibility()
    const { sleep, calls } = recordingSleep()
    const governor = new VisibilityGovernor({
      visibility,
      sleep,
      backgroundDutyCycle: 0.1,
      sliceMs: 10,
    })

    // A trivial executor: this test is about pacing, not about WASM.
    let started = 0
    const counting: Executor = {
      nodeId: 'n0',
      async execute(task: Task) {
        started += 1
        // Background the tab midway through the job.
        if (started === 2) visibility.set(true)
        return { ok: true, output: { i: task.partitionIndex }, fuelUsed: 1, attestation: 'signed-by-nobody' }
      },
    }

    const store = new MemoryBlockstore()
    const moduleCid = await store.put(new Uint8Array([0]))
    const executors = [new GovernedExecutor(counting, governor)]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The job is not lost by being backgrounded — every shard still completes.
    expect(result.job.complete).toBe(true)
    expect(started).toBe(4)
    // And the throttle did take effect: at least one slice was paid for.
    expect(calls.length).toBeGreaterThan(0)
    expect(governor.sleptMs).toBeGreaterThan(0)
  })
})

describe('GovernedExecutor', () => {
  it('preserves node identity, so throttling is not a change of identity', async () => {
    const visibility = new FakeVisibility()
    const governor = new VisibilityGovernor({ visibility })
    const inner: Executor = {
      nodeId: 'node-a',
      async execute() {
        return { ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' }
      },
    }
    const governed = new GovernedExecutor(inner, governor)
    // Verification groups results by node id; a governor-dependent id would make
    // throttling look like divergence.
    expect(governed.nodeId).toBe('node-a')
    expect(governed.dutyCycle).toBe(1)
    expect(governed.executed).toBe(0)
  })
})

describe('GovernedExecutor — concurrency cannot bypass the cap', () => {
  it('serializes while throttled, so a duty cycle actually paces a concurrent job', async () => {
    const visibility = new FakeVisibility()
    visibility.hidden = true // start throttled
    const { sleep, calls } = recordingSleep()
    const governor = new VisibilityGovernor({
      visibility,
      sleep,
      backgroundDutyCycle: 0.1,
      sliceMs: 10,
    })

    let concurrent = 0
    let peak = 0
    const inner: Executor = {
      nodeId: 'n0',
      async execute(task: Task) {
        concurrent += 1
        peak = Math.max(peak, concurrent)
        await Promise.resolve()
        concurrent -= 1
        return { ok: true, output: { i: task.partitionIndex }, fuelUsed: 1, attestation: 'signed-by-nobody' }
      },
    }
    const governed = new GovernedExecutor(inner, governor)

    const store = new MemoryBlockstore()
    const moduleCid = await store.put(new Uint8Array([1]))
    const executors = [governed]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    // Four shards dispatched concurrently, but never two running at once, and one
    // idle period paid per task. Without serialization peak would be 4 and calls
    // would still be 4 — but all four sleeps would overlap, costing one slice total.
    expect(peak).toBe(1)
    expect(calls).toHaveLength(4)
    expect(governor.sleptMs).toBeCloseTo(4 * 90, 6)
  })

  it('keeps full parallelism when not throttled', async () => {
    const visibility = new FakeVisibility()
    const { sleep, calls } = recordingSleep()
    const governor = new VisibilityGovernor({ visibility, sleep })

    let concurrent = 0
    let peak = 0
    const inner: Executor = {
      nodeId: 'n0',
      async execute(task: Task) {
        concurrent += 1
        peak = Math.max(peak, concurrent)
        await new Promise((r) => setTimeout(r, 5))
        concurrent -= 1
        return { ok: true, output: { i: task.partitionIndex }, fuelUsed: 1, attestation: 'signed-by-nobody' }
      },
    }

    const store = new MemoryBlockstore()
    const moduleCid = await store.put(new Uint8Array([2]))
    const executors = [new GovernedExecutor(inner, governor)]
    await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      store,
    )

    // A full-rate node must not be quietly serialized by the governor's presence.
    expect(peak).toBeGreaterThan(1)
    expect(calls).toEqual([])
  })
})
