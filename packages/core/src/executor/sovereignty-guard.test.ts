import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import type { Executor, ExecutionOutcome, Task } from '../ports.ts'
import { guardSovereignty } from './sovereignty-guard.ts'
import type { NodeSovereignty } from './sovereignty-guard.ts'

/**
 * DATA-09 — a serving node refuses a sovereign task it is not cleared for, before
 * its inner `Executor` ever runs.
 *
 * The ordering is the whole requirement, so every refusal case below watches for
 * execution rather than only the outcome's `ok` field — a guard that runs the
 * module and *then* reports refusal has already handed over the decryption key.
 * Mirrors `distributed.test.ts`'s AUTH-03 "never calls the executor" pattern one
 * layer down, without RPC.
 */

const MODULE_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

const baseTask: Omit<Task, 'label' | 'ownerId'> = {
  moduleCid: MODULE_CID,
  inputCid: MODULE_CID,
  partitionIndex: 0,
  partitionCount: 1,
}

/** An executor that counts calls and returns a canned success — the watched inner. */
function watched(): { executor: Executor; count: () => number } {
  let calls = 0
  const executor: Executor = {
    nodeId: 'w0',
    async execute(): Promise<ExecutionOutcome> {
      calls += 1
      return { ok: true, output: null, fuelUsed: 1 }
    },
  }
  return { executor, count: () => calls }
}

describe('guardSovereignty — DATA-09 refusal before instantiation', () => {
  it('calls inner.execute unchanged for a sovereign task from a cleared owner', async () => {
    const { executor, count } = watched()
    const node: NodeSovereignty = { ownerId: 'alice', canExecuteSovereign: true }
    const guarded = guardSovereignty(executor, node)

    const task: Task = { ...baseTask, label: 'sovereign', ownerId: 'alice' }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1 })
  })

  it('refuses a sovereign task for its own owner when not cleared to execute it', async () => {
    const { executor, count } = watched()
    const node: NodeSovereignty = { ownerId: 'alice', canExecuteSovereign: false }
    const guarded = guardSovereignty(executor, node)

    const task: Task = { ...baseTask, label: 'sovereign', ownerId: 'alice' }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(0)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('w0')
    expect(outcome.reason).toContain('alice')
    expect(outcome.reason).toContain('sovereignty')
  })

  it('refuses a sovereign task belonging to a different owner, regardless of clearance', async () => {
    const { executor, count } = watched()
    const node: NodeSovereignty = { ownerId: 'alice', canExecuteSovereign: true }
    const guarded = guardSovereignty(executor, node)

    const task: Task = { ...baseTask, label: 'sovereign', ownerId: 'bob' }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(0)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('w0')
    expect(outcome.reason).toContain('bob')
    expect(outcome.reason).toContain('sovereignty')
  })

  it('always calls inner.execute unchanged for a public task, regardless of clearance', async () => {
    const { executor, count } = watched()
    const node: NodeSovereignty = { ownerId: 'alice', canExecuteSovereign: false }
    const guarded = guardSovereignty(executor, node)

    const task: Task = { ...baseTask, label: 'public' }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1 })
  })

  it('always calls inner.execute unchanged for a task with no label at all', async () => {
    const { executor, count } = watched()
    const node: NodeSovereignty = { ownerId: 'alice', canExecuteSovereign: false }
    const guarded = guardSovereignty(executor, node)

    // Matches every pre-Phase-12 Task literal in the repo — label is absent entirely.
    const outcome = await guarded.execute(baseTask as Task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1 })
  })

  it('passes the inner executor\'s nodeId through unchanged', () => {
    const { executor } = watched()
    const node: NodeSovereignty = { ownerId: 'alice', canExecuteSovereign: true }
    const guarded = guardSovereignty(executor, node)
    expect(guarded.nodeId).toBe(executor.nodeId)
  })
})
