import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STRAGGLER_FACTOR,
  SpeculationLedger,
  median,
  settleRace,
  speculativeCandidates,
  stragglers,
} from './speculation.ts'
import type { NodeDescriptor, PlacementRequest } from './sovereignty.ts'

/** CHURN-02, CHURN-06. */

const T0 = 1_800_000_000_000

const node = (nodeId: string, ownerId = 'alice'): NodeDescriptor => ({
  nodeId,
  ownerId,
  canExecuteSovereign: true,
  load: 0,
})

const sovereign: PlacementRequest = {
  shardId: 's0',
  label: 'sovereign',
  ownerId: 'alice',
  redundancy: 1,
}

const publicShard: PlacementRequest = { shardId: 's0', label: 'public', redundancy: 1 }

describe('CHURN-06 — a speculative duplicate cannot leave the owner’s nodes', () => {
  it('offers only the owner’s other nodes, however many idle foreigners there are', () => {
    // The pressure case: alice's second node is the *only* legal target, and eight
    // idle foreign nodes sit next to it. A "pick anyone, quickly" duplicate lands on
    // one of them, which is precisely the breach this criterion names.
    const nodes = [
      node('alice-1'),
      node('alice-2'),
      ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 'bob')),
    ]

    const candidates = speculativeCandidates(sovereign, nodes, ['alice-1'])

    expect(candidates.map((n) => n.nodeId)).toEqual(['alice-2'])
    expect(candidates.every((n) => n.ownerId === 'alice')).toBe(true)
  })

  it('yields nothing when the owner has one node — waiting is the correct answer', () => {
    const nodes = [node('alice-1'), ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 'bob'))]
    expect(speculativeCandidates(sovereign, nodes, ['alice-1'])).toEqual([])
  })

  it('excludes an owner node that holds only an encrypted replica', () => {
    const nodes: NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 1 },
      { nodeId: 'alice-cold', ownerId: 'alice', canExecuteSovereign: false, load: 0 },
    ]
    expect(speculativeCandidates(sovereign, nodes, ['alice-1'])).toEqual([])
  })

  it('treats a sovereign request with no owner as broken, not unrestricted', () => {
    const nodes = [node('alice-1'), node('bob-1', 'bob')]
    const broken: PlacementRequest = { shardId: 's0', label: 'sovereign', redundancy: 1 }
    expect(speculativeCandidates(broken, nodes, [])).toEqual([])
  })

  it('lets a public shard duplicate anywhere it is not already running', () => {
    const nodes = [node('a'), node('b', 'bob'), node('c', 'carol')]
    expect(speculativeCandidates(publicShard, nodes, ['a']).map((n) => n.nodeId)).toEqual(['b', 'c'])
  })
})

describe('CHURN-02 — stragglers are found by comparison, not by a fixed timeout', () => {
  it('flags a task running far longer than its peers', () => {
    const completed = [1_000, 1_100, 900, 1_050]
    const inFlight = [
      { taskId: 'slow', nodeId: 'n0', startedAt: T0 - 5_000 },
      { taskId: 'normal', nodeId: 'n1', startedAt: T0 - 500 },
    ]
    const found = stragglers(inFlight, T0, { completed })
    expect(found.map((t) => t.taskId)).toEqual(['slow'])
  })

  it('flags nothing before there are enough completions to compare against', () => {
    // With two samples the "median" is an average of two numbers, and the first
    // slightly slow task looks like a straggler.
    const inFlight = [{ taskId: 'slow', nodeId: 'n0', startedAt: T0 - 60_000 }]
    expect(stragglers(inFlight, T0, { completed: [1_000, 1_100] })).toEqual([])
    expect(stragglers(inFlight, T0, { completed: [1_000, 1_100, 900] })).toHaveLength(1)
  })

  it('uses the factor as the boundary, exclusively', () => {
    const completed = [1_000, 1_000, 1_000]
    const threshold = 1_000 * DEFAULT_STRAGGLER_FACTOR
    const at = (elapsed: number) =>
      stragglers([{ taskId: 't', nodeId: 'n', startedAt: T0 - elapsed }], T0, { completed })

    expect(at(threshold)).toEqual([])
    expect(at(threshold + 1)).toHaveLength(1)
  })

  it('orders the worst offender first', () => {
    const completed = [1_000, 1_000, 1_000]
    const found = stragglers(
      [
        { taskId: 'bad', nodeId: 'n0', startedAt: T0 - 5_000 },
        { taskId: 'worse', nodeId: 'n1', startedAt: T0 - 9_000 },
      ],
      T0,
      { completed },
    )
    expect(found.map((t) => t.taskId)).toEqual(['worse', 'bad'])
  })

  it('computes a median that is a median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe('CHURN-02 — the budget is global and spent', () => {
  it('allows a fraction of the task count and then refuses', () => {
    const ledger = new SpeculationLedger({ tasks: 100, fraction: 0.1 })
    expect(ledger.allowance).toBe(10)

    for (let i = 0; i < 10; i++) expect(ledger.request(`t${i}`)).toBe(true)

    // Planted violation: the eleventh straggler asks. Unbounded speculation doubles
    // a job's cost in exactly the conditions where cost matters.
    expect(ledger.request('t10')).toBe(false)
    expect(ledger.spent).toBe(10)
    expect(ledger.remaining).toBe(0)
  })

  it('refuses to duplicate the same task twice', () => {
    const ledger = new SpeculationLedger({ tasks: 100, fraction: 0.5 })
    expect(ledger.request('t0')).toBe(true)
    expect(ledger.request('t0')).toBe(false)
    expect(ledger.spent).toBe(1)
    expect(ledger.duplicated('t0')).toBe(true)
  })

  it('reports the multiplier whether or not speculation was used', () => {
    const unused = new SpeculationLedger({ tasks: 10, fraction: 0.5 })
    expect(unused.multiplier).toBe(1)

    const used = new SpeculationLedger({ tasks: 10, fraction: 0.5 })
    used.request('t0')
    used.request('t1')
    expect(used.multiplier).toBe(1.2)
  })

  it('gives a small job no allowance rather than rounding one up', () => {
    // floor(5 * 0.1) = 0. A five-task job has no tail worth paying for.
    const ledger = new SpeculationLedger({ tasks: 5, fraction: 0.1 })
    expect(ledger.allowance).toBe(0)
    expect(ledger.request('t0')).toBe(false)
  })

  it('rejects nonsense construction', () => {
    expect(() => new SpeculationLedger({ tasks: -1 })).toThrow(RangeError)
    expect(() => new SpeculationLedger({ tasks: 1, fraction: -0.1 })).toThrow(RangeError)
  })

  it('names the task each discarded copy was a copy of, over a job of several', () => {
    // The seam the `Discarded`/`RaceLoser` split created, exercised end to end: a race
    // returns what a race can determine, and the id is added by whoever held it. One
    // job-wide ledger takes both races, so the two tasks' losers land in one list and a
    // mixed-up id has somewhere to show. Without this, `discard` stamping `''` — the
    // exact value the split removed from `settleRace` — left all 46 cases green.
    const ledger = new SpeculationLedger({ tasks: 10, fraction: 1 })

    const races = [
      // shard-a's copies agree; shard-b's disagree. So a loser attributed to the wrong
      // task also lands the disagreement on the wrong task, which is the consequence
      // that matters: this system's most informative event pointing at the wrong shard.
      {
        taskId: 'shard-a',
        answers: [
          { nodeId: 'a-fast', resultCid: 'bafyA', at: T0 + 100 },
          { nodeId: 'a-slow', resultCid: 'bafyA', at: T0 + 900 },
        ],
      },
      {
        taskId: 'shard-b',
        answers: [
          { nodeId: 'b-fast', resultCid: 'bafyB', at: T0 + 50 },
          { nodeId: 'b-slow', resultCid: 'bafyOTHER', at: T0 + 400 },
        ],
      },
    ]

    for (const { taskId, answers } of races) {
      const outcome = settleRace(answers)
      expect(outcome.settled).toBe(true)
      if (!outcome.settled) continue
      for (const loser of outcome.losers) ledger.discard(taskId, loser.nodeId, loser.disagreed)
    }

    expect(ledger.discarded).toEqual([
      { taskId: 'shard-a', nodeId: 'a-slow', disagreed: false },
      { taskId: 'shard-b', nodeId: 'b-slow', disagreed: true },
    ])
  })
})

describe('CHURN-02 — first result wins, and disagreement still surfaces', () => {
  it('takes the earliest arrival and discards the rest', () => {
    const outcome = settleRace([
      { nodeId: 'slow', resultCid: 'bafyA', at: T0 + 900 },
      { nodeId: 'fast', resultCid: 'bafyA', at: T0 + 100 },
    ])

    expect(outcome.settled).toBe(true)
    if (!outcome.settled) return
    expect(outcome.winner).toBe('fast')
    expect(outcome.resultCid).toBe('bafyA')
    expect(outcome.losers.map((l) => l.nodeId)).toEqual(['slow'])
    // The loser is harmless because it produced the same CID — not because
    // anything cancelled it.
    expect(outcome.disagreed).toBe(false)
  })

  it('reports a disagreement rather than burying it under first-wins', () => {
    // The event this whole system exists to detect, arriving through the one path
    // where it would be easiest to ignore.
    const outcome = settleRace([
      { nodeId: 'fast', resultCid: 'bafyA', at: T0 + 100 },
      { nodeId: 'slow', resultCid: 'bafyB', at: T0 + 900 },
    ])

    expect(outcome.settled).toBe(true)
    if (!outcome.settled) return
    expect(outcome.winner).toBe('fast')
    expect(outcome.disagreed).toBe(true)
    expect(outcome.losers[0]).toMatchObject({ nodeId: 'slow', disagreed: true })
  })

  it('ignores a copy that never produced anything', () => {
    const outcome = settleRace([
      { nodeId: 'gone', resultCid: null, at: T0 + 10 },
      { nodeId: 'alive', resultCid: 'bafyA', at: T0 + 900 },
    ])
    expect(outcome.settled).toBe(true)
    if (!outcome.settled) return
    expect(outcome.winner).toBe('alive')
    expect(outcome.losers).toEqual([])
  })

  it('reports an unsettled race when no copy answered', () => {
    const outcome = settleRace([
      { nodeId: 'gone', resultCid: null, at: T0 },
      { nodeId: 'also-gone', resultCid: null, at: T0 },
    ])
    expect(outcome.settled).toBe(false)
    if (outcome.settled) return
    expect(outcome.reason).toContain('no copy')
  })

  it('returns a loser that cannot carry a task id, because a race is not told one', () => {
    // Verified by `npm run typecheck`, not by running this file: `''` is a valid
    // string, so no runtime assertion could ever see the hollow field this
    // replaces. A planted `'PROBE-NOT-A-TASK-ID'` left all 44 cases green.
    const outcome = settleRace([
      { nodeId: 'fast', resultCid: 'bafyA', at: T0 + 100 },
      { nodeId: 'slow', resultCid: 'bafyA', at: T0 + 900 },
    ])
    expect(outcome.settled).toBe(true)
    if (!outcome.settled) return
    // @ts-expect-error a race is handed answers, and an answer names a node and a
    // CID and no task. Putting `taskId` back on this type makes this suppression
    // unused and `tsc --noEmit` fails.
    expect(outcome.losers[0]?.taskId).toBeUndefined()
  })

  it('breaks a dead-heat on node id so the outcome is reproducible', () => {
    const answers = [
      { nodeId: 'b', resultCid: 'bafyA', at: T0 },
      { nodeId: 'a', resultCid: 'bafyA', at: T0 },
    ]
    const once = settleRace(answers)
    const twice = settleRace([...answers].reverse())
    expect(once.settled && once.winner).toBe('a')
    expect(twice.settled && twice.winner).toBe('a')
  })
})
