import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import type { Executor, ExecutionOutcome, Task } from '../ports.ts'
import type { NameRecord } from '../naming.ts'
import { guardNetworkReach } from './network-reach-guard.ts'

/**
 * CAP-01 — a serving node refuses a task whose module declares network reach when the
 * task is labelled sovereign, before its inner `Executor` ever runs. `guardNetworkReach`'s
 * only refusal variant is `'declared-against-sovereign'`, and Case A below is the one case
 * that constructs it.
 *
 * The ordering is the whole requirement, so every case below watches for execution
 * rather than only the outcome's `ok` field — the same discipline
 * `sovereignty-guard.test.ts` establishes for its own subject, one layer over: a guard
 * that runs the module and *then* reports refusal has already reached
 * `WebAssembly.instantiate`.
 *
 * Two controls sit beside the refusal case, and neither is decorative (46-CONTEXT.md
 * §5): the positive control (Case B) proves the refusal is not a broken fixture
 * refusing everything, and the declares-nothing double control (Cases C/D/E) proves a
 * module that never opts in — never sets `wantsNetworkReach`, so `guardNetworkReach`
 * cannot classify it as `'declared-against-sovereign'` — is unaffected on both labels.
 */

const MODULE_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

const baseTask: Omit<Task, 'label' | 'moduleRecord'> = {
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
      return { ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' }
    },
  }
  return { executor, count: () => calls }
}

/**
 * A `NameRecord`-shaped fixture. This guard never verifies the record — it reads
 * `wantsNetworkReach` off whatever arrived, unverified — so the signer/signature values
 * do not need to be cryptographically real, only type-valid.
 */
function moduleRecord(declares: boolean): NameRecord {
  return {
    name: 'example-module',
    cid: MODULE_CID,
    version: 1,
    expiresAt: 1_900_000_000_000,
    signer: 'a'.repeat(64),
    signature: 'b'.repeat(128),
    // The second variant omits the field entirely, not `wantsNetworkReach: undefined` —
    // matching the spread-omit discipline naming.ts and protocol.ts already established.
    ...(declares ? { wantsNetworkReach: true as const } : {}),
  }
}

describe('guardNetworkReach — CAP-01 refusal before instantiation', () => {
  it('refuses a sovereign task whose module declares network reach, before inner.execute runs', async () => {
    const { executor, count } = watched()
    const guarded = guardNetworkReach(executor)

    const task: Task = { ...baseTask, label: 'sovereign', moduleRecord: moduleRecord(true) }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(0)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('w0')
    expect(outcome.reason).toContain(MODULE_CID.toString())
    expect(outcome.reason).toContain('sovereign')
    expect(outcome.reason).toContain('network reach')
    expect(outcome.reason).not.toContain('sovereignty violation')
    expect(outcome.reason).not.toContain('module provenance refused')
  })

  it('the positive control — the same declaring module against a public task reaches inner.execute unchanged', async () => {
    const { executor, count } = watched()
    const guarded = guardNetworkReach(executor)

    const task: Task = { ...baseTask, label: 'public', moduleRecord: moduleRecord(true) }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' })
  })

  it('a sovereign task whose module record carries no wantsNetworkReach reaches inner.execute unchanged', async () => {
    const { executor, count } = watched()
    const guarded = guardNetworkReach(executor)

    const task: Task = { ...baseTask, label: 'sovereign', moduleRecord: moduleRecord(false) }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' })
  })

  it('a sovereign task whose moduleRecord is entirely absent reaches inner.execute unchanged — this guard manufactures no refusal of its own', async () => {
    const { executor, count } = watched()
    const guarded = guardNetworkReach(executor)

    const task: Task = { ...baseTask, label: 'sovereign' }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' })
  })

  it('the declares-nothing double control — a public task with no moduleRecord reaches inner.execute unchanged', async () => {
    const { executor, count } = watched()
    const guarded = guardNetworkReach(executor)

    const task: Task = { ...baseTask, label: 'public' }
    const outcome = await guarded.execute(task)

    expect(count()).toBe(1)
    expect(outcome).toEqual({ ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' })
  })

  it("passes the inner executor's nodeId through unchanged", () => {
    const { executor } = watched()
    const guarded = guardNetworkReach(executor)
    expect(guarded.nodeId).toBe(executor.nodeId)
  })
})
