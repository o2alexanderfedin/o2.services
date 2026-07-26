import { describe, expect, it } from 'vitest'
import { LeaseTable, checkLease, shouldRenew } from './lease.ts'

/**
 * CHURN-04, and the visible history CHURN-01 asks for.
 *
 * The invariant under test throughout: **liveness changes who computes a task and
 * when, never what the answer is.** Every test below is either a case of that, or a
 * check on the one mechanism that could break it — a stale completion overwriting a
 * re-dispatch.
 */

const T0 = 1_800_000_000_000
const LEASE = 10_000

const table = (options: { maxGenerations?: number } = {}) =>
  new LeaseTable({ leaseMs: LEASE, maxGenerations: options.maxGenerations ?? 3 })

describe('CHURN-04 — a lease is a deadline, not a lock', () => {
  it('grants a task and reports its holder', () => {
    const leases = table()
    const lease = leases.grant('t0', 'n0', T0)

    expect(lease?.nodeId).toBe('n0')
    expect(lease?.expiresAt).toBe(T0 + LEASE)
    expect(lease?.generation).toBe(1)
    expect(leases.holder('t0')?.nodeId).toBe('n0')
  })

  it('refuses to grant a task someone still holds', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)

    // Two holders with neither told is the one thing a lease table must never do by
    // accident. Speculation does it deliberately, with a budget, elsewhere.
    expect(leases.grant('t0', 'n1', T0 + 1)).toBeNull()
    expect(leases.holder('t0')?.nodeId).toBe('n0')
  })

  it('frees the task once the deadline passes, with nobody releasing anything', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)

    // The coordinator has gone away. Nothing runs. The deadline still passes.
    const regranted = leases.grant('t0', 'n1', T0 + LEASE)
    expect(regranted?.nodeId).toBe('n1')
    expect(regranted?.generation).toBe(2)
  })

  it('reaps expired leases and says which may be re-dispatched', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)
    leases.grant('t1', 'n1', T0)

    expect(leases.reap(T0 + LEASE - 1)).toEqual([])

    const reaped = leases.reap(T0 + LEASE)
    expect(reaped.map((r) => r.taskId)).toEqual(['t0', 't1'])
    expect(reaped.every((r) => r.redispatchable)).toBe(true)
    expect(reaped[0]?.previousHolder).toBe('n0')
  })

  it('renews a live lease and refuses to renew a lapsed one', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)

    const renewed = leases.renew('t0', 'n0', T0 + 5_000)
    expect(renewed?.expiresAt).toBe(T0 + 5_000 + LEASE)

    // Planted violation: a node that fell silent past its deadline tries to reclaim
    // the task. If this succeeded it could resume work the coordinator has already
    // re-dispatched — two holders, table believing there is one.
    const lapsed = table()
    lapsed.grant('t1', 'n0', T0)
    expect(lapsed.renew('t1', 'n0', T0 + LEASE)).toBeNull()
  })

  it('refuses a renewal from a node that does not hold the lease', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)
    expect(leases.renew('t0', 'n1', T0 + 1_000)).toBeNull()
  })
})

describe('CHURN-04 — a stale completion cannot overwrite a re-dispatch', () => {
  it('refuses a completion from a node whose lease has lapsed', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)

    // n0 was slow, not dead. It finishes just after its deadline.
    expect(leases.complete('t0', 'n0', T0 + LEASE)).toBe(false)
    expect(leases.history.at(-1)).toMatchObject({ kind: 'stale-completion', nodeId: 'n0' })
  })

  it('closes the correctness path even with the deadline ignored', () => {
    // Pins the distinction `complete` documents. The scenario that could actually
    // change an answer is a *re-granted* task, and it is the holder check — not the
    // deadline — that closes it. Here n0's report is refused because n1 holds the
    // task now, at a moment when n0's own lease has not even lapsed by much.
    const leases = table()
    leases.grant('t0', 'n0', T0)
    leases.reap(T0 + LEASE)
    leases.grant('t0', 'n1', T0 + LEASE)

    expect(leases.complete('t0', 'n0', T0 + LEASE + 1)).toBe(false)
    expect(leases.holder('t0')?.nodeId).toBe('n1')
    // n1's own completion is unaffected by n0's noise.
    expect(leases.complete('t0', 'n1', T0 + LEASE + 2)).toBe(true)
  })

  it('refuses a completion from a node that never held the task', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)

    expect(leases.complete('t0', 'n-other', T0 + 1)).toBe(false)
    expect(leases.holder('t0')?.nodeId).toBe('n0')
  })

  it('refuses the original holder after the task moved on', () => {
    // The sequence that matters: n0 goes quiet, the task is re-dispatched to n1,
    // n1 answers, and *then* n0 comes back with its own answer.
    const leases = table()
    leases.grant('t0', 'n0', T0)
    leases.reap(T0 + LEASE)
    leases.grant('t0', 'n1', T0 + LEASE)
    expect(leases.complete('t0', 'n1', T0 + LEASE + 1)).toBe(true)

    expect(leases.complete('t0', 'n0', T0 + LEASE + 2)).toBe(false)
    const stale = leases.history.filter((e) => e.kind === 'stale-completion')
    expect(stale).toHaveLength(1)
  })

  it('accepts a completion from the current holder inside its lease', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)
    expect(leases.complete('t0', 'n0', T0 + LEASE - 1)).toBe(true)
    expect(leases.holder('t0')).toBeUndefined()
    // A completed task is finished, not re-grantable.
    expect(leases.grant('t0', 'n1', T0 + LEASE)).toBeNull()
  })
})

describe('re-dispatch is bounded', () => {
  it('abandons a task that has used its generations rather than looping forever', () => {
    const leases = table({ maxGenerations: 2 })
    leases.grant('t0', 'n0', T0)
    leases.reap(T0 + LEASE)
    leases.grant('t0', 'n1', T0 + LEASE)

    const reaped = leases.reap(T0 + 2 * LEASE)
    expect(reaped[0]?.redispatchable).toBe(false)
    expect(leases.abandoned).toEqual(['t0'])

    // And it stays abandoned — no later grant revives it.
    expect(leases.grant('t0', 'n2', T0 + 3 * LEASE)).toBeNull()
  })

  it('records the abandonment once, not on every subsequent look', () => {
    const leases = table({ maxGenerations: 1 })
    leases.grant('t0', 'n0', T0)
    leases.reap(T0 + LEASE)
    leases.reap(T0 + 2 * LEASE)
    expect(leases.history.filter((e) => e.kind === 'abandoned')).toHaveLength(1)
  })

  it('rejects nonsense construction rather than guessing', () => {
    expect(() => new LeaseTable({ leaseMs: 0 })).toThrow(RangeError)
    expect(() => new LeaseTable({ maxGenerations: 0 })).toThrow(RangeError)
  })
})

describe('CHURN-01 — re-dispatches are visible, not hidden', () => {
  it('records every grant, expiry, re-grant and completion in order', () => {
    const leases = table()
    leases.grant('t0', 'n0', T0)
    leases.reap(T0 + LEASE)
    leases.grant('t0', 'n1', T0 + LEASE)
    leases.complete('t0', 'n1', T0 + LEASE + 1)

    expect(leases.history.map((e) => e.kind)).toEqual([
      'granted',
      'expired',
      'granted',
      'completed',
    ])
    expect(leases.redispatches).toBe(1)
  })

  it('counts re-dispatches across many tasks so a job’s cost is explicable', () => {
    const leases = table()
    for (const task of ['t0', 't1', 't2']) leases.grant(task, 'n0', T0)
    leases.reap(T0 + LEASE)
    for (const task of ['t0', 't1', 't2']) leases.grant(task, 'n1', T0 + LEASE)

    expect(leases.redispatches).toBe(3)
    expect(leases.history.filter((e) => e.kind === 'expired')).toHaveLength(3)
  })

  it('records an expiry even when the re-grant discovers it', () => {
    // The coordinator may never call reap — a grant on a lapsed lease finds it
    // first. The history must not depend on which path noticed.
    const leases = table()
    leases.grant('t0', 'n0', T0)
    leases.grant('t0', 'n1', T0 + LEASE)
    expect(leases.history.map((e) => e.kind)).toEqual(['granted', 'expired', 'granted'])
  })
})

describe('the worker’s own view of its lease', () => {
  it('reports remaining time, then overdue time', () => {
    const lease = { taskId: 't0', nodeId: 'n0', grantedAt: T0, expiresAt: T0 + LEASE, generation: 1 }
    expect(checkLease(lease, T0 + 4_000)).toEqual({ expired: false, remainingMs: 6_000 })
    expect(checkLease(lease, T0 + LEASE)).toEqual({ expired: true, overdueMs: 0 })
    expect(checkLease(lease, T0 + LEASE + 500)).toEqual({ expired: true, overdueMs: 500 })
  })

  it('asks for a heartbeat at two-thirds, leaving room for it to arrive', () => {
    const lease = { taskId: 't0', nodeId: 'n0', grantedAt: T0, expiresAt: T0 + LEASE, generation: 1 }
    expect(shouldRenew(lease, T0 + 6_000)).toBe(false)
    expect(shouldRenew(lease, T0 + 6_667)).toBe(true)
    // Past the deadline there is nothing to renew — the task has moved on.
    expect(shouldRenew(lease, T0 + LEASE)).toBe(false)
  })
})
