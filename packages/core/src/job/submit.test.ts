import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import { signName } from '../naming.ts'
import type { Executor, ExecutionOutcome, Task } from '../ports.ts'
import { LocalCapacity } from '../placement.ts'
import type { Admission, AdmissionControl, Offer } from '../placement.ts'
import { publicNodes } from '../sovereignty.ts'
import type { NodeDescriptor } from '../sovereignty.ts'
import { submitJob } from './submit.ts'
import type { ShardSpec } from './submit.ts'
import { executeVerified } from './verify.ts'

const MODULE_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

/** An executor that sums the shard's numbers — honest and deterministic. */
function honest(nodeId: string): Executor {
  return {
    nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      return {
        ok: true,
        output: { shard: task.partitionIndex, of: task.partitionCount, sum: task.partitionIndex * 10 },
        fuelUsed: 100,
      }
    },
  }
}

/** An executor that returns a wrong answer — the divergence case. */
function liar(nodeId: string): Executor {
  return {
    nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      return {
        ok: true,
        output: { shard: task.partitionIndex, of: task.partitionCount, sum: 999 },
        fuelUsed: 100,
      }
    },
  }
}

function failing(nodeId: string, reason: string): Executor {
  return {
    nodeId,
    async execute(): Promise<ExecutionOutcome> {
      return { ok: false, reason }
    },
  }
}

/** An executor whose `execute` rejects — a foreign implementation breaking, not answering. */
function throwing(nodeId: string, message: string): Executor {
  return {
    nodeId,
    async execute(): Promise<ExecutionOutcome> {
      throw new Error(message)
    },
  }
}

/** An executor whose output contains NaN — refused by the codec, not divergence. */
function nanProducer(nodeId: string): Executor {
  return {
    nodeId,
    async execute(): Promise<ExecutionOutcome> {
      return { ok: true, output: { mean: Number.NaN } as CanonicalValue, fuelUsed: 100 }
    },
  }
}

const task: Task = {
  moduleCid: MODULE_CID,
  inputCid: MODULE_CID,
  partitionIndex: 0,
  partitionCount: 1,
}

describe('executeVerified — agreement', () => {
  it('agrees when two honest executors produce the same output', async () => {
    const r = await executeVerified(task, [honest('a'), honest('b')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.replicas).toBe(2)
      expect([...r.agreeing].sort()).toEqual(['a', 'b'])
      // Gross counts both replicas; useful counts the one that produced the answer.
      expect(r.grossFuel).toBe(200)
      expect(r.usefulFuel).toBe(100)
    }
  })

  it('accepts a single executor as the R=1 case (VER-06)', async () => {
    const r = await executeVerified(task, [honest('solo')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') expect(r.replicas).toBe(1)
  })

  it('reports insufficient rather than agreed when no executors are supplied', async () => {
    const r = await executeVerified(task, [])
    expect(r.status).toBe('insufficient')
  })
})

describe('executeVerified — disagreement is surfaced, never voted away (VER-01)', () => {
  it('reports disagreement with the dissenting node named', async () => {
    const r = await executeVerified(task, [honest('a'), honest('b'), liar('c')])
    expect(r.status).toBe('disagreed')
    if (r.status === 'disagreed') {
      expect(r.partitions).toHaveLength(2)
      const dissent = r.partitions.find((p) => p.nodes.includes('c'))
      expect(dissent).toBeDefined()
      expect(dissent?.nodes).toEqual(['c'])
    }
  })

  it('does NOT majority-vote a 2-vs-1 disagreement into an answer', async () => {
    const r = await executeVerified(task, [honest('a'), honest('b'), liar('c')])
    // A majority exists, and it is still not reported as agreement — hiding the
    // event would defeat the mechanism's purpose.
    expect(r.status).not.toBe('agreed')
  })

  it('surfaces an executor failure without treating it as divergence', async () => {
    const r = await executeVerified(task, [honest('a'), failing('b', 'oom')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing).toEqual(['a'])
      expect(r.replicas).toBe(1)
    }
  })

  it('reports insufficient when every executor fails', async () => {
    const r = await executeVerified(task, [failing('a', 'x'), failing('b', 'y')])
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.failures.map((f) => f.nodeId).sort()).toEqual(['a', 'b'])
    }
  })

  it('names a replica that threw, with what it threw, instead of rejecting', async () => {
    const r = await executeVerified(task, [throwing('bad', 'blockstore ENOSPC')])
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.failures.map((f) => f.nodeId)).toEqual(['bad'])
      expect(r.failures[0]?.reason).toContain('ENOSPC')
    }
  })

  it('treats an unencodable NaN output as that node failing, not as divergence', async () => {
    const r = await executeVerified(task, [honest('a'), nanProducer('b')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing).toEqual(['a'])
    }
  })
})

/**
 * VER-05, stated over the comparison `executeVerified` actually performs.
 *
 * What is compared is the content address of the output and nothing else. Every case
 * here supplies executors that differ in something a naive implementation might have
 * folded in — the node that ran it, the fuel it burned — and requires agreement
 * anyway. Including any of those would make every honest redundant execution
 * disagree, and the disagreement would be misdiagnosed as guest nondeterminism.
 */
describe('what is compared covers (task, output) only (VER-05)', () => {
  it('ignores node identity — two differently-named nodes with identical output agree', async () => {
    const first: Executor = {
      nodeId: '12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, sum: 7 }, fuelUsed: 5 }
      },
    }
    const second: Executor = {
      nodeId: 'a-node-whose-id-shares-nothing-with-the-first',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, sum: 7 }, fuelUsed: 5 }
      },
    }

    const r = await executeVerified(task, [first, second])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.replicas).toBe(2)
      expect([...r.agreeing].sort()).toEqual([second.nodeId, first.nodeId].sort())
    }
  })

  it('ignores fuel and timing — two nodes differing only in fuel still agree', async () => {
    const slow: Executor = {
      nodeId: 'slow',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, of: t.partitionCount, sum: 0 }, fuelUsed: 99999 }
      },
    }
    const fast: Executor = {
      nodeId: 'fast',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, of: t.partitionCount, sum: 0 }, fuelUsed: 1 }
      },
    }
    const r = await executeVerified(task, [slow, fast])
    expect(r.status).toBe('agreed')
  })
})

describe('submitJob — sharding and content addressing (MR-01, DATA-01)', () => {
  it('runs 4 shards at R=2 and returns a result CID per shard', async () => {
    const store = new MemoryBlockstore()
    const executors = [honest('a'), honest('b'), honest('c')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.job.complete).toBe(true)
    expect(r.job.shards).toHaveLength(4)
    for (const s of r.job.shards) {
      expect(s.verification.status).toBe('agreed')
      if (s.verification.status === 'agreed') {
        expect(s.verification.replicas).toBe(2)
      }
    }
    // 4 input blocks + 4 distinct output blocks.
    expect(store.size).toBe(8)
  })

  it('reports the verification multiplier as a measured cost (VER-06)', async () => {
    const store = new MemoryBlockstore()
    const executors = [honest('a'), honest('b')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ n: 1 }, { n: 2 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.job.verificationMultiplier).toBe(2)
      expect(r.job.grossFuel).toBe(400)
      expect(r.job.usefulFuel).toBe(200)
    }
  })

  it('reports a multiplier of 1 at R=1 — verification off costs nothing', async () => {
    const store = new MemoryBlockstore()
    const executors = [honest('a')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ n: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.job.verificationMultiplier).toBe(1)
  })

  it('gives each shard its partition index and count', async () => {
    const store = new MemoryBlockstore()
    const executors = [honest('a'), honest('b')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ n: 1 }, { n: 2 }, { n: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const [i, s] of r.job.shards.entries()) {
      expect(s.verification.status).toBe('agreed')
      if (s.verification.status === 'agreed') {
        expect(s.verification.output).toEqual({ shard: i, of: 3, sum: i * 10 })
      }
    }
  })

  it('marks the job incomplete when one shard diverges', async () => {
    const store = new MemoryBlockstore()
    // 'c' lies; with redundancy 2 and offset selection, at least one shard pairs
    // an honest node with the liar.
    const executors = [honest('a'), liar('c')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ n: 1 }, { n: 2 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.job.complete).toBe(false)
      expect(r.job.shards.some((s) => s.verification.status === 'disagreed')).toBe(true)
    }
  })

  it('an executor that throws is one failed replica, not a rejected submitJob', async () => {
    const store = new MemoryBlockstore()
    const executors = [honest('good'), throwing('bad', 'blockstore ENOSPC')]
    // `.resolves` rather than a bare await: a rejection then reads as a failed
    // assertion here rather than as an unhandled rejection somewhere else.
    await expect(
      submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [{ value: { n: 1 }, label: 'public' as const }],
          executors,
          nodes: publicNodes(executors),
          redundancy: 2,
        },
        store,
      ),
    ).resolves.toMatchObject({ ok: true })

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' as const }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    // The co-replica's completed work survives its neighbour's collapse.
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      expect(shard.verification.agreeing).toEqual(['good'])
      expect(shard.verification.replicas).toBe(1)
    }
  })

  it('gives identical input CIDs for identical shard values — dedup is free', async () => {
    const store = new MemoryBlockstore()
    const executors = [honest('a'), honest('b')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ n: 7 }, { n: 7 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      store,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      const [first, second] = r.job.shards
      expect(first?.inputCid.toString()).toBe(second?.inputCid.toString())
    }
  })
})

describe('submitJob — input validation', () => {
  it('refuses a job with no shards', async () => {
    const executors = [honest('a')]
    const r = await submitJob(
      { moduleCid: MODULE_CID, shards: [], executors, nodes: publicNodes(executors), redundancy: 1 },
      new MemoryBlockstore(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('no-shards')
  })

  it('refuses redundancy below 1', async () => {
    const executors = [honest('a')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 0,
      },
      new MemoryBlockstore(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('bad-redundancy')
  })

  it('degrades rather than refuses when executors are fewer than redundancy', async () => {
    const executors = [honest('a')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 3,
      },
      new MemoryBlockstore(),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.job.complete).toBe(false)
      const [shard] = r.job.shards
      expect(shard?.verification.status).toBe('agreed')
      if (shard?.verification.status === 'agreed') expect(shard.verification.replicas).toBe(1)
      expect(shard?.degraded).toBe(true)
    }
  })

  it('refuses a shard input containing NaN', async () => {
    const executors = [honest('a')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [
          { value: { n: 1 }, label: 'public' },
          { value: { bad: Number.NaN } as CanonicalValue, label: 'public' },
        ],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'input-not-encodable') {
      expect(r.error.partitionIndex).toBe(1)
    }
  })
})

describe('DATA-03/DATA-04 — sovereignty wired onto submitJob', () => {
  it('places a sovereign shard on its owner’s node under load pressure engineered to force relocation', async () => {
    // Alice's only node is saturated; four foreign nodes are completely idle —
    // the exact arrangement sovereignty.test.ts uses one layer down. Any
    // scheduler that treats sovereignty as a preference, not a filter, moves
    // the shard here.
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 1, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-1', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-2', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-3', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-4', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    const executors = nodes.map((n) => honest(n.nodeId))
    const store = new MemoryBlockstore()

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes,
        redundancy: 1,
      },
      store,
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      // Never one of the four idle foreign nodes, despite them being the
      // "cheaper" choice by every load signal.
      expect(shard.verification.agreeing).toEqual(['alice-1'])
    }
  })

  it('DATA-09 — a node that genuinely holds the shard data but cannot decrypt it is still excluded from execution', async () => {
    // The interesting DATA-09 case: a replica node that is not a stub. The
    // shared blockstore genuinely holds the sovereign shard's input (every
    // shard is persisted before placement, unconditionally), so `replica-1`
    // could answer a block request for it — it is excluded purely by
    // `canExecuteSovereign`, never because it lacks the data.
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 0.9, certificate: 'carries-no-certificate' },
      { nodeId: 'replica-1', ownerId: 'alice', canExecuteSovereign: false, load: 0, certificate: 'carries-no-certificate' },
    ]
    let replicaCalls = 0
    const replicaExecutor: Executor = {
      nodeId: 'replica-1',
      async execute(task: Task): Promise<ExecutionOutcome> {
        replicaCalls += 1
        return { ok: true, output: { shard: task.partitionIndex, of: task.partitionCount, sum: 0 }, fuelUsed: 1 }
      },
    }
    const executors = [honest('alice-1'), replicaExecutor]
    const store = new MemoryBlockstore()

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes,
        redundancy: 1,
      },
      store,
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      expect(shard.verification.agreeing).toEqual(['alice-1'])
    }
    expect(replicaCalls).toBe(0)
    expect(await store.has(shard!.inputCid)).toBe(true)
  })

  it('reports a degraded, agreed shard rather than an error when redundancy exceeds the owner’s live node count', async () => {
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    const executors = [honest('alice-1')]
    const store = new MemoryBlockstore()

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes,
        redundancy: 2,
      },
      store,
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') expect(shard.verification.replicas).toBe(1)
    expect(shard?.degraded).toBe(true)
    expect(r.job.complete).toBe(false)
  })

  it('rejects a sovereign shard with no owner via a distinct SubmitError, not silently treated as public', async () => {
    const executors = [honest('a')]
    const brokenShard = { value: { n: 1 }, label: 'sovereign' } as unknown as ShardSpec
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [brokenShard],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'shard-missing-owner') {
      expect(r.error.partitionIndex).toBe(0)
    }
  })

  it('rejects an executor with no matching node descriptor rather than letting it slip past placement', async () => {
    const executors = [honest('ghost')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: [],
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'missing-node-descriptor') {
      expect(r.error.nodeId).toBe('ghost')
    }
  })
})

describe('DET-03/DATA-08 — the signed module record reaches every task submitJob builds', () => {
  /**
   * An executor that keeps the task it was handed.
   *
   * The assertion is made off what the executor *received*, never off `submitJob`'s
   * internals, because the receiving executor is the only vantage point that matches
   * where the check actually happens: `guardModuleProvenance` wraps an executor and
   * reads `task.moduleRecord` before `inner.execute`.
   */
  function recording(nodeId: string): { executor: Executor; seen: () => Task | undefined } {
    let captured: Task | undefined
    return {
      executor: {
        nodeId,
        async execute(task: Task): Promise<ExecutionOutcome> {
          captured = task
          return { ok: true, output: { shard: task.partitionIndex }, fuelUsed: 1 }
        },
      },
      seen: () => captured,
    }
  }

  // A real record rather than a literal: the fixture is then the same shape the
  // production path carries, so a change to `NameRecord` fails here too.
  const publisher = new Uint8Array(32).fill(31)
  const moduleRecord = signName(publisher, {
    name: 'colouring',
    cid: MODULE_CID,
    version: 1,
    expiresAt: 2_000_000_000_000,
  })

  it('puts the record on a public shard’s task', async () => {
    const rec = recording('a')
    const executors = [rec.executor]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        moduleRecord,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    expect(rec.seen()?.moduleRecord).toBe(moduleRecord)
  })

  it('puts the record on a sovereign shard’s task', async () => {
    // Both branches of the `Task` literal are asserted, because a two-branch literal
    // is the exact place a field gets added to one arm and forgotten on the other.
    const rec = recording('alice-1')
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        moduleRecord,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }],
        executors: [rec.executor],
        nodes,
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    expect(rec.seen()?.label).toBe('sovereign')
    expect(rec.seen()?.moduleRecord).toBe(moduleRecord)
  })

  it('omits the key entirely when the spec carries no record', async () => {
    const rec = recording('a')
    const executors = [rec.executor]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    const task = rec.seen()
    expect(task).toBeDefined()
    if (task === undefined) return
    // `Object.hasOwn`, not `toBeUndefined`: an explicit `undefined` key is a different
    // shape from an absent one, and `encodeRequest` would put the first on the wire.
    expect(Object.hasOwn(task, 'moduleRecord')).toBe(false)
  })
})

/**
 * SCHED-02/SCHED-03 — `submitJob`'s offer arm.
 *
 * Every case below supplies `spec.admit`, which is the **selector**: with it, each
 * shard is placed by `planWithOffers` (sample by rendezvous rank, take the
 * least-loaded of the sample, offer, re-pick on refusal). Without it, `planPlacement`
 * as before. The two are alternatives and are never composed — see `JobSpec.admit`'s
 * doc for the line that makes composing them lose the re-pick.
 *
 * Nothing in this block edits a pre-existing case. That is deliberate and is itself
 * the regression bar: the ~60 `submitJob` call sites in this repository pass no
 * `admit`, so if any pre-existing case here needed a change, the no-offer arm would
 * have moved and the change would be the defect rather than the fix.
 */
describe('SCHED-03 — submitJob places by offers when it is given a way to ask', () => {
  /**
   * An `admit` that refuses the nodes it is told to and records every offer it saw.
   *
   * The recording is the load-bearing half. A refusal reason is a *string* and stays
   * plausible under a mutation that places somewhere it should not; the list of nodes
   * actually **asked** is what catches a shard that reached a node it must never have
   * been offered to. Assert the read, not only the reason.
   */
  function refusing(
    refuse: ReadonlySet<string>,
    reason: (nodeId: string) => string,
  ): { admit: AdmissionControl; offered: () => readonly string[] } {
    const seen: string[] = []
    return {
      admit: (offer: Offer): Admission => {
        seen.push(offer.nodeId)
        return refuse.has(offer.nodeId)
          ? { accepted: false, reason: reason(offer.nodeId), capacity: 'states-no-capacity' }
          : { accepted: true, capacity: 'states-no-capacity' }
      },
      offered: () => seen,
    }
  }

  const REFUSAL = 'busy repainting the kitchen'

  it('re-picks onto a node that did not refuse, and reports the refusal it collected', async () => {
    const executors = [honest('n1'), honest('n2')]
    const nodes = publicNodes(executors)
    // Which of the two is sampled first is decided by rendezvous rank on the shard
    // id, not by this list's order, so the fixture refuses whichever was asked first
    // rather than naming one. That keeps the case about re-picking rather than about
    // the ranking, which `placement.test.ts` already covers.
    const first = (await firstAsked(nodes)) as string
    const stub = refusing(new Set([first]), () => REFUSAL)

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes,
        redundancy: 1,
        admit: stub.admit,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      // Placed on the other one — the re-pick happened.
      expect(shard.verification.agreeing).not.toEqual([first])
    }
    // Both were asked, the refuser first: the read count, not the reason string.
    expect(stub.offered()).toHaveLength(2)
    expect(stub.offered()[0]).toBe(first)
    expect(shard?.rejections.map((x) => x.nodeId)).toStrictEqual([first])
  })

  it('carries the node’s own words, not a reason submitJob composed', async () => {
    const executors = [honest('n1'), honest('n2')]
    const nodes = publicNodes(executors)
    const first = (await firstAsked(nodes)) as string
    const stub = refusing(new Set([first]), (nodeId) => `${REFUSAL} (${nodeId})`)

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes,
        redundancy: 1,
        admit: stub.admit,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The exact string the stub returned. A requestor that composed its own reason
    // from the node id would produce something plausible and different.
    expect(r.job.shards[0]?.rejections[0]?.reason).toBe(`${REFUSAL} (${first})`)
  })

  it('a caller that made no offers gets an empty refusal list, because nothing refused', async () => {
    const executors = [honest('n1')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // `[]` is a truthful reading rather than a default: no offer was made, so nothing
    // refused. Asserted rather than reached by omission.
    expect(r.job.shards[0]?.rejections).toStrictEqual([])
  })

  it('reports a shard unplaceable when every candidate refuses, with the refusals visible', async () => {
    const executors = [honest('n1'), honest('n2'), honest('n3')]
    const nodes = publicNodes(executors)
    const stub = refusing(new Set(['n1', 'n2', 'n3']), (nodeId) => `${nodeId} says no`)

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes,
        redundancy: 1,
        admit: stub.admit,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    // A stalled shard is the correct outcome; the record of why is what `rejections` is for.
    expect(shard?.verification.status).toBe('insufficient')
    expect(shard?.rejections.map((x) => x.nodeId).sort()).toStrictEqual(['n1', 'n2', 'n3'])
    expect(shard?.rejections.map((x) => x.reason).sort()).toStrictEqual([
      'n1 says no',
      'n2 says no',
      'n3 says no',
    ])
    expect(r.job.complete).toBe(false)
  })

  it('never relocates a sovereign shard onto a cheaper foreign node when the owner’s node refuses', async () => {
    // The load ordering is doing everything it can to relocate: the owner's only node
    // is fully loaded AND refuses, while three foreign nodes are completely idle.
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 1, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-1', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-2', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-3', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    const executors = nodes.map((n) => honest(n.nodeId))
    const stub = refusing(new Set(['alice-1']), () => 'owner node is full')

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes,
        redundancy: 1,
        admit: stub.admit,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('insufficient')
    expect(shard?.rejections.map((x) => x.nodeId)).toStrictEqual(['alice-1'])
    // The three foreign nodes were never even ASKED. This is the reading that catches
    // a leak: a reason string would stay plausible while the shard landed on bob.
    expect(stub.offered()).toStrictEqual(['alice-1'])
  })

  it('both arms narrow before they score — one fixture, two placements, same chosen node', async () => {
    // Exactly one eligible node, three cheaper foreign ones. If cost were scored
    // before sovereignty on either arm, a foreign node would win on every load signal.
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 0.9, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-1', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-2', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'bob-3', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    const executors = nodes.map((n) => honest(n.nodeId))
    const shards: readonly ShardSpec[] = [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }]
    const accepting = refusing(new Set(), () => 'unused')

    // Arm A — no `admit`, so `planPlacement`.
    const viaPlan = await submitJob(
      { moduleCid: MODULE_CID, shards, executors, nodes, redundancy: 1 },
      new MemoryBlockstore(),
    )
    // Arm B — same fixture, an `admit` supplied, so `planWithOffers`.
    const viaOffers = await submitJob(
      { moduleCid: MODULE_CID, shards, executors, nodes, redundancy: 1, admit: accepting.admit },
      new MemoryBlockstore(),
    )

    expect(viaPlan.ok && viaOffers.ok).toBe(true)
    if (!viaPlan.ok || !viaOffers.ok) return
    const a = viaPlan.job.shards[0]?.verification
    const b = viaOffers.job.shards[0]?.verification
    expect(a?.status).toBe('agreed')
    expect(b?.status).toBe('agreed')
    // Written as one comparison rather than two assertions: the point is that the two
    // arms AGREE, which is what says `eligibleNodes` is the same gate on both.
    if (a?.status === 'agreed' && b?.status === 'agreed') {
      expect(a.agreeing).toStrictEqual(b.agreeing)
      expect(a.agreeing).toStrictEqual(['alice-1'])
    }
    // And the offer arm only ever asked the eligible one.
    expect(accepting.offered()).toStrictEqual(['alice-1'])
  })

  it('inherits 18-04’s cross-shard bound — a 1-slot node takes one shard, not four', async () => {
    // `LocalCapacity` is the real thing rather than a stub, so the headroom the tally
    // reads is a figure a node genuinely published. Not re-implemented here: this is
    // `planWithOffers`' own bound, reached through the submit path.
    const capacity = new LocalCapacity({ nodeId: 'only', maxConcurrent: 1 })
    const executors = [honest('only')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [0, 1, 2, 3].map((i) => ({ value: { n: i }, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        admit: (offer: Offer): Admission => capacity.would(offer),
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const placed = r.job.shards.filter((s) => s.verification.status === 'agreed')
    expect(placed).toHaveLength(1)
    // The three held back were never asked, so they carry no refusal — a node held
    // back was not a node that refused.
    const heldBack = r.job.shards.filter((s) => s.verification.status !== 'agreed')
    expect(heldBack).toHaveLength(3)
    expect(heldBack.flatMap((s) => s.rejections)).toStrictEqual([])
    // `would` reserves nothing, which is what makes the bound the requestor's own.
    expect(capacity.peakInFlight).toBe(0)
  })
})

/**
 * The no-offer arm, pinned by the two properties that distinguish it — SCHED-02.
 *
 * **These cases exist because the obvious regression bar does not discriminate.**
 * 18-05-PLAN.md claims the no-`admit` arm is protected by *"every pre-existing case
 * passes unedited"*, reddened *"by making the `planWithOffers` arm unconditional"*.
 * That was planted and measured: with the arm forced unconditional, the whole
 * repository still passed — 1596 tests, zero failures. The reason is structural.
 * `planWithOffers` called with no `admit` builds no recording wrapper, bounds
 * nothing, and `placeWithOffers` then accepts every candidate — so on every fixture
 * in this repository the two arms happened to choose the same nodes, and the bar the
 * plan named was satisfied by the defect it existed to catch.
 *
 * What actually separates them is visible only with enough nodes to make sampling
 * differ from ordering:
 *
 * - `planPlacement` orders **every** eligible node by load and takes the best, so it
 *   returns the globally least-loaded node.
 * - `placeWithOffers` samples `DEFAULT_D` candidates by rendezvous rank on the shard
 *   id and takes the least-loaded **of that sample**, which is the global minimum
 *   only by coincidence.
 *
 * Plus the `dispatchCount` nudge, which exists on the no-offer arm alone.
 */
describe('SCHED-02 — the no-offer arm places exactly as it did before this phase', () => {
  it('takes the globally least-loaded node, not the least-loaded of a sample', async () => {
    // Five nodes with distinct loads. Ordering returns `n-idle` every time; sampling
    // two of five by rendezvous rank returns it only when it happens to be drawn.
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'n-idle', ownerId: 'public', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'n-b', ownerId: 'public', canExecuteSovereign: true, load: 0.2, certificate: 'carries-no-certificate' },
      { nodeId: 'n-c', ownerId: 'public', canExecuteSovereign: true, load: 0.4, certificate: 'carries-no-certificate' },
      { nodeId: 'n-d', ownerId: 'public', canExecuteSovereign: true, load: 0.6, certificate: 'carries-no-certificate' },
      { nodeId: 'n-e', ownerId: 'public', canExecuteSovereign: true, load: 0.8, certificate: 'carries-no-certificate' },
    ]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: nodes.map((n) => honest(n.nodeId)),
        nodes,
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.job.shards[0]?.verification
    expect(v?.status).toBe('agreed')
    if (v?.status === 'agreed') expect(v.agreeing).toStrictEqual(['n-idle'])
  })

  it('keeps the dispatchCount nudge — four shards over four idle nodes land one each', async () => {
    // Every node starts at load 0, so only the nudge breaks the tie. Without it,
    // ordering is by node id and all four shards pile onto the same node.
    const nodes: readonly NodeDescriptor[] = ['w0', 'w1', 'w2', 'w3'].map((nodeId) => ({
      nodeId,
      ownerId: 'public',
      canExecuteSovereign: true,
      load: 0,
      certificate: 'carries-no-certificate',
    }))
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [0, 1, 2, 3].map((i) => ({ value: { n: i }, label: 'public' as const })),
        executors: nodes.map((n) => honest(n.nodeId)),
        nodes,
        redundancy: 1,
      },
      new MemoryBlockstore(),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const chosen = r.job.shards.map((s) =>
      s.verification.status === 'agreed' ? s.verification.agreeing[0] : undefined,
    )
    // One shard each, in order — the round-robin the nudge reproduces.
    expect(chosen).toStrictEqual(['w0', 'w1', 'w2', 'w3'])
  })
})

/**
 * Which node `placeWithOffers` asks first for shard `'0'`, derived rather than
 * assumed: the sample comes from rendezvous rank on the shard id, so hardcoding a
 * node id here would make the surrounding cases depend on a hash they do not test.
 */
async function firstAsked(nodes: readonly NodeDescriptor[]): Promise<string | undefined> {
  let first: string | undefined
  const executors = nodes.map((n) => honest(n.nodeId))
  await submitJob(
    {
      moduleCid: MODULE_CID,
      shards: [{ value: { n: 1 }, label: 'public' }],
      executors,
      nodes,
      redundancy: 1,
      admit: (offer: Offer): Admission => {
        first ??= offer.nodeId
        return { accepted: true, capacity: 'states-no-capacity' }
      },
    },
    new MemoryBlockstore(),
  )
  return first
}
