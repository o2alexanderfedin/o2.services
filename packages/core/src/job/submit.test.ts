import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { JobCheckpoint } from '../checkpoint.ts'
import { describeCoverage } from '../coverage.ts'
import type { CoverageReport } from '../coverage.ts'
import { EnrollmentAuthority, requestEnrollment } from '../enrollment.ts'
import type { NodeCertificate } from '../enrollment.ts'
import { DEFAULT_LEASE_MS, DEFAULT_MAX_GENERATIONS } from '../lease.ts'
import { signName } from '../naming.ts'
import type { Blockstore, Executor, ExecutionOutcome, Task } from '../ports.ts'
import { LocalCapacity } from '../placement.ts'
import type { Admission, AdmissionControl, Offer } from '../placement.ts'
import { signResult } from '../result-attestation.ts'
import type { ResultSigner } from '../result-attestation.ts'
import { DEFAULT_SPECULATION_FRACTION, MIN_SAMPLES } from '../speculation.ts'
import { publicNodes } from '../sovereignty.ts'
import type { NodeDescriptor } from '../sovereignty.ts'
import { DEFAULT_SPECULATION_WATCHDOG_MS, submitJob } from './submit.ts'
import type {
  CheckpointSink,
  JobClock,
  JobResult,
  JobSpec,
  ShardResult,
  ShardSpec,
  SubmitOptions,
} from './submit.ts'
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
        attestation: 'signed-by-nobody',
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
        attestation: 'signed-by-nobody',
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
      return { ok: true, output: { mean: Number.NaN } as CanonicalValue, fuelUsed: 100, attestation: 'signed-by-nobody' }
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
      expect(r.agreeing.map((e) => e.nodeId).sort()).toEqual(['a', 'b'])
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
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['a'])
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
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['a'])
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
        return { ok: true, output: { shard: t.partitionIndex, sum: 7 }, fuelUsed: 5, attestation: 'signed-by-nobody' }
      },
    }
    const second: Executor = {
      nodeId: 'a-node-whose-id-shares-nothing-with-the-first',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, sum: 7 }, fuelUsed: 5, attestation: 'signed-by-nobody' }
      },
    }

    const r = await executeVerified(task, [first, second])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.replicas).toBe(2)
      expect(r.agreeing.map((e) => e.nodeId).sort()).toEqual([second.nodeId, first.nodeId].sort())
    }
  })

  it('ignores fuel and timing — two nodes differing only in fuel still agree', async () => {
    const slow: Executor = {
      nodeId: 'slow',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, of: t.partitionCount, sum: 0 }, fuelUsed: 99999, attestation: 'signed-by-nobody' }
      },
    }
    const fast: Executor = {
      nodeId: 'fast',
      async execute(t) {
        return { ok: true, output: { shard: t.partitionIndex, of: t.partitionCount, sum: 0 }, fuelUsed: 1, attestation: 'signed-by-nobody' }
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        store,
        // CHURN-03 — this test asserts nothing about checkpointing.
        { checkpoints: 'checkpoints-nothing' },
      ),
    ).resolves.toMatchObject({ ok: true })

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' as const }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    // The co-replica's completed work survives its neighbour's collapse.
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual(['good'])
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
      {
        moduleCid: MODULE_CID,
        shards: [],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      // Never one of the four idle foreign nodes, despite them being the
      // "cheaper" choice by every load signal.
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual(['alice-1'])
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
        return { ok: true, output: { shard: task.partitionIndex, of: task.partitionCount, sum: 0 }, fuelUsed: 1, attestation: 'signed-by-nobody' }
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual(['alice-1'])
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
          return { ok: true, output: { shard: task.partitionIndex }, fuelUsed: 1, attestation: 'signed-by-nobody' }
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: stub.admit,
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [shard] = r.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      // Placed on the other one — the re-pick happened.
      expect(shard.verification.agreeing.map((e) => e.nodeId)).not.toEqual([first])
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: stub.admit,
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: stub.admit,
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: stub.admit,
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
      { moduleCid: MODULE_CID, shards, executors, nodes, redundancy: 1, onQuorumShortfall: 'runs-at-available-redundancy' },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    // Arm B — same fixture, an `admit` supplied, so `planWithOffers`.
    const viaOffers = await submitJob(
      { moduleCid: MODULE_CID, shards, executors, nodes, redundancy: 1, onQuorumShortfall: 'runs-at-available-redundancy', admit: accepting.admit },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
      expect(a.agreeing.map((e) => e.nodeId)).toStrictEqual(['alice-1'])
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: (offer: Offer): Admission => capacity.would(offer),
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.job.shards[0]?.verification
    expect(v?.status).toBe('agreed')
    if (v?.status === 'agreed') expect(v.agreeing.map((e) => e.nodeId)).toStrictEqual(['n-idle'])
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
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const chosen = r.job.shards.map((s) =>
      s.verification.status === 'agreed' ? s.verification.agreeing[0]?.nodeId : undefined,
    )
    // One shard each, in order — the round-robin the nudge reproduces.
    expect(chosen).toStrictEqual(['w0', 'w1', 'w2', 'w3'])
  })
})

// ---------------------------------------------------------------------------
// WIRE-04, CHURN-01, CHURN-04, SCHED-06 — a shard that lost its executor is
// placed again, under a lease.
// ---------------------------------------------------------------------------

/**
 * The generation loop, six cases, each stating what it CANNOT redden on.
 *
 * That sentence per case is required rather than decorative. Phase 18 shipped a
 * tautology into this very path — `expect(shard.verification.agreeing).toHaveLength(1)`
 * over an `agreed` narrowing where `agreeing ⊆ placement.nodeIds` and that length **is**
 * `redundancy` = 1, so the reading was confined to `{0,1}` with `0` already excluded —
 * and `M36` exists because nobody had written down what it could not catch. So each case
 * below names its own blind spot, and where two cases look like one claim stated twice,
 * the note says which of them actually carries it.
 *
 * **Deterministic by construction.** Failure is driven by which executor a fixture hands
 * over, never by a timer, and the two renewal arms run on a *virtual* clock whose only
 * source of advancement is the module's own `sleep`. Nothing here races a real clock.
 */
describe('WIRE-04/CHURN-01 — a shard whose executor refuses or dies is placed again', () => {
  /** An executor that records that it ran, so "was this node attempted" is read, not inferred. */
  function watched(nodeId: string, ran: string[], inner: Executor = honest(nodeId)): Executor {
    return {
      nodeId,
      async execute(task: Task): Promise<ExecutionOutcome> {
        ran.push(nodeId)
        return inner.execute(task)
      },
    }
  }

  /** The events of one kind, in order — the history is where a route is visible. */
  function kinds(history: readonly { readonly kind: string }[]): readonly string[] {
    return history.map((event) => event.kind)
  }

  it('re-places a refused shard onto an untried node, and says so beside a control that never had to', async () => {
    // Redundancy 1 over three nodes at equal load, so `planPlacement` orders by id and
    // chooses `n1` — derived from the rule, not hardcoded taste.
    const failedRun: string[] = []
    const cleanRun: string[] = []
    const build = (first: Executor, ran: string[]): JobSpec => {
      const executors = [first, watched('n2', ran), watched('n3', ran)]
      return {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      }
    }

    const retried = await submitJob(
      build(watched('n1', failedRun, failing('n1', 'took the shard and then refused it')), failedRun),
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    // The control, in the SAME case and the same run: an identical fixture whose first
    // choice does not fail. A re-dispatch count is only legible against a job that
    // never had to retry, and a job that completes proves nothing on its own — this one
    // completes too.
    const clean = await submitJob(build(watched('n1', cleanRun), cleanRun), new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(retried.ok && clean.ok).toBe(true)
    if (!retried.ok || !clean.ok) return
    const shard = retried.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    if (shard.verification.status === 'agreed') {
      // WHICH node answered. "It completed" is satisfied by the control below.
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toStrictEqual(['n2'])
    }
    expect(shard.attempted).toStrictEqual(['n1', 'n2'])
    expect(shard.ending).toBe('agreed')
    expect(kinds(retried.job.leaseHistory)).toStrictEqual([
      'granted',
      'surrendered',
      'granted',
      'completed',
    ])
    // Comparative, inside one run: one more dispatch than the control, one more node.
    expect(retried.job.redispatches).toBe(clean.job.redispatches + 1)
    expect(shard.attempted.length).toBe((clean.job.shards[0] as ShardResult).attempted.length + 1)
    expect(clean.job.redispatches).toBe(0)
    expect(failedRun).toStrictEqual(['n1', 'n2'])

    // WHAT THIS CANNOT REDDEN ON. It cannot catch a widened eligibility gate: the shard
    // is public, so every node is eligible and there is nothing to leak past. It also
    // cannot carry the under-replication trigger — at redundancy 1 the only shortfall
    // expressible is `insufficient`, so a loop that triggered on `insufficient` alone
    // would pass this case exactly as written. The case below is the one that catches
    // that, and this note is here so nobody reads the pair as one claim twice.
  })

  it('tops up a shard that agreed below its redundancy, and reaches full redundancy across two generations', async () => {
    // Redundancy 2 over four nodes: `planPlacement` takes `n1` and `n2`, and `n2` fails.
    // `executeVerified` returns **`agreed` with `replicas: 1`** — not `insufficient` —
    // which is the trigger this case exists for and the one the case above cannot reach.
    const ran: string[] = []
    const executors = [
      watched('n1', ran),
      watched('n2', ran, failing('n2', 'died between the offer and the dispatch')),
      watched('n3', ran),
      watched('n4', ran),
    ]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    if (shard.verification.status === 'agreed') {
      // Two agreeing replicas, verified TOGETHER — one answer confirmed by two nodes
      // across two generations, not two separate agreements reported side by side.
      expect(shard.verification.replicas).toBe(2)
      expect(shard.verification.agreeing.map((e) => e.nodeId).sort()).toStrictEqual(['n1', 'n3'])
      // The top-up landed on a node the first placement did not choose.
      expect(shard.attempted.slice(0, 2)).toStrictEqual(['n1', 'n2'])
    }
    expect(shard.attempted).toStrictEqual(['n1', 'n2', 'n3'])
    expect(shard.generations).toBe(2)
    // The load-bearing one: it asked for 2 and it GOT 2, so it is not degraded. A loop
    // that reported the two generations as separate agreements, or that re-ran the full
    // redundancy instead of the shortfall, cannot produce this pair of readings.
    expect(shard.degraded).toBe(false)
    expect(r.job.complete).toBe(true)
    expect(r.job.redispatches).toBe(1)
    // `n4` was never needed, so it was never run. Read off the executor, not inferred.
    expect(ran).toStrictEqual(['n1', 'n2', 'n3'])

    // WHAT THIS CANNOT REDDEN ON. A loop triggering on `insufficient` **only** goes red
    // here and stays green on the case above, which is why this one and not that one
    // carries the second trigger. It cannot catch the bound (three nodes is under the
    // cap) and it cannot catch a widened gate (public shard).
  })

  it('keeps a sovereign shard on its owner’s nodes across generations, and stops rather than leaving them', async () => {
    // Two owners in one fixture, run as two submissions, because the pair is the claim:
    // the first shows a second generation happening at all under sovereignty, the second
    // is the one that could catch a leak.
    const alice: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'alice-2', ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    const carol: readonly NodeDescriptor[] = [
      { nodeId: 'carol-1', ownerId: 'carol', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]
    // Idle and cheap, so every load signal in the fixture argues for relocating.
    const foreign: readonly NodeDescriptor[] = ['bob-1', 'bob-2', 'bob-3'].map((nodeId) => ({
      nodeId,
      ownerId: 'bob',
      canExecuteSovereign: true,
      load: 0,
      certificate: 'carries-no-certificate',
    }))

    const twoNodeRan: string[] = []
    const twoNodeExecutors = [
      watched('alice-1', twoNodeRan, failing('alice-1', 'owner node dropped the dispatch')),
      watched('alice-2', twoNodeRan),
      ...foreign.map((n) => watched(n.nodeId, twoNodeRan)),
    ]
    const twoNodes = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'alice' }],
        executors: twoNodeExecutors,
        nodes: [...alice, ...foreign],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    const oneNodeRan: string[] = []
    const oneNodeExecutors = [
      watched('carol-1', oneNodeRan, failing('carol-1', 'owner node dropped the dispatch')),
      ...foreign.map((n) => watched(n.nodeId, oneNodeRan)),
    ]
    const oneNode = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'carol' }],
        executors: oneNodeExecutors,
        nodes: [...carol, ...foreign],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(twoNodes.ok && oneNode.ok).toBe(true)
    if (!twoNodes.ok || !oneNode.ok) return

    const alicesShard = twoNodes.job.shards[0] as ShardResult
    expect(alicesShard.verification.status).toBe('agreed')
    if (alicesShard.verification.status === 'agreed') {
      expect(alicesShard.verification.agreeing.map((e) => e.nodeId)).toStrictEqual(['alice-2'])
    }
    expect(alicesShard.attempted).toStrictEqual(['alice-1', 'alice-2'])
    expect(twoNodeRan).toStrictEqual(['alice-1', 'alice-2'])

    const carolsShard = oneNode.job.shards[0] as ShardResult
    // The owner's only node failed and there is nowhere legal left, so the shard stops.
    // A stalled sovereign shard is the correct outcome — `sovereignty.ts`'s own words.
    expect(carolsShard.verification.status).toBe('insufficient')
    expect(carolsShard.ending).toBe('no-untried-node')
    // The anti-vacuity read: exactly the owner's own node was attempted, and nobody
    // else. Reading `attempted` and the executors' own record, not the absence of an
    // error — a reason string stays perfectly plausible while the shard runs on bob.
    expect(carolsShard.attempted).toStrictEqual(['carol-1'])
    expect(oneNodeRan).toStrictEqual(['carol-1'])
    expect(oneNode.job.complete).toBe(false)

    // WHAT THESE CANNOT REDDEN ON. The two-node arm cannot catch a widened pool: with
    // every node at load 0 the ordering is by id, and `alice-2` sorts before every
    // `bob-*`, so a loop re-placing over the whole node set would choose it anyway. The
    // one-node arm is the one that could — and note precisely what it can catch and what
    // it cannot. It catches a loop that dispatches to an untried executor **directly**.
    // It does NOT catch a loop that hands the wrong pool to `planPlacement` or
    // `planWithOffers`, because both call `eligibleNodes` as their first act on whatever
    // they are given, so the gate re-runs and refuses `bob-*` regardless. That guarantee
    // lives in `sovereignty.ts` and is asserted there; what is asserted here is that the
    // generation loop still goes through a placer at all.
  })

  it('stops at the generation cap, naming every node that failed it, with the lease abandoned', async () => {
    // Five nodes, every one of them failing. The pool is deliberately larger than the
    // cap so that "it stopped" is not explained by running out of nodes.
    const ran: string[] = []
    const executors = ['n1', 'n2', 'n3', 'n4', 'n5'].map((nodeId) =>
      watched(nodeId, ran, failing(nodeId, `${nodeId} trapped`)),
    )
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    // Exactly the cap, from the exported constant rather than a literal — "it stopped"
    // is satisfied by a bug that stops after one.
    expect(shard.generations).toBe(DEFAULT_MAX_GENERATIONS)
    expect(shard.attempted).toStrictEqual(['n1', 'n2', 'n3'])
    expect(shard.attempted.length).toBe(DEFAULT_MAX_GENERATIONS)
    expect(ran).toStrictEqual(['n1', 'n2', 'n3'])
    expect(shard.ending).toBe('generations-spent')
    expect(r.job.redispatches).toBe(DEFAULT_MAX_GENERATIONS - 1)
    expect(shard.verification.status).toBe('insufficient')
    if (shard.verification.status === 'insufficient') {
      // Every node that failed it, and why, merged across the generations.
      expect(shard.verification.failures.map((f) => f.nodeId)).toStrictEqual(['n1', 'n2', 'n3'])
      expect(shard.verification.failures.map((f) => f.reason)).toStrictEqual([
        'n1 trapped',
        'n2 trapped',
        'n3 trapped',
      ])
    }
    // The bound is the lease table's, and the table says so in its own history.
    expect(kinds(r.job.leaseHistory)).toContain('abandoned')

    // WHAT THIS CANNOT REDDEN ON. It cannot distinguish *why* the cap is three — a loop
    // with its own hardcoded counter of 3 passes this exactly. What separates the two is
    // the `abandoned` event, which only the lease table can produce, so that assertion
    // and not the count is what says the bound lives where this plan claims it does.
  })

  it('renews a lease only against evidence the holder is still working — one fixture, both arms', async () => {
    /**
     * ONE fixture, ONE flag. The flag is *whether the holder is still there*, and a
     * holder that is there is observable in exactly two ways: it holds the task's
     * capacity slot, so it refuses a duplicate claim on it, and it eventually answers.
     * A holder that has gone does neither. Two fixtures behaving differently would prove
     * nothing about a rule; this is one fixture read twice.
     */
    async function run(holderStillThere: boolean): Promise<{
      readonly job: JobResult
      readonly holderId: string
      readonly spareId: string
      readonly probed: readonly string[]
      readonly slotKey: string
    }> {
      const nodes = publicNodes([{ nodeId: 'h1' }, { nodeId: 'h2' }])
      // Which node the offer arm asks first is rendezvous rank on the shard id, so it is
      // derived rather than named — the same reason `firstAsked` exists at all.
      const holderId = (await firstAsked(nodes)) as string
      const spareId = holderId === 'h1' ? 'h2' : 'h1'
      // Real `LocalCapacity`, not a stub. The refusal string the renewal probe matches on
      // is composed in `placement.ts` and nowhere else; driving the real object is what
      // makes a change to it turn this case red instead of silently making every renewal
      // unreachable.
      const capacity = new Map(
        nodes.map((n) => [n.nodeId, new LocalCapacity({ nodeId: n.nodeId, maxConcurrent: 4 })]),
      )

      let slotKey = ''
      let answerHolder: ((outcome: ExecutionOutcome) => void) | null = null
      const holderWork = new Promise<ExecutionOutcome>((resolve) => {
        answerHolder = resolve
      })
      const holder: Executor = {
        nodeId: holderId,
        execute(task: Task): Promise<ExecutionOutcome> {
          // Exactly what `serveAgent`'s exec branch does: reserve under the task's own
          // derived key. The key is read off the real task rather than guessed.
          slotKey = `${task.inputCid.toString()}:${task.partitionIndex}`
          if (holderStillThere) {
            ;(capacity.get(holderId) as LocalCapacity).offer({ shardId: slotKey, nodeId: holderId })
          }
          return holderWork
        },
      }

      const probed: string[] = []
      let inFlightRefusals = 0
      const admit = (offer: Offer): Admission => {
        probed.push(offer.shardId)
        const decision = (capacity.get(offer.nodeId) as LocalCapacity).would(offer)
        if (!decision.accepted && decision.reason === `${offer.shardId} is already in flight here`) {
          inFlightRefusals += 1
          // A holder that has shown it is working twice then finishes, which is the
          // whole point of renewal: it bought the time to finish in.
          if (inFlightRefusals >= 2 && answerHolder !== null) {
            answerHolder({
              ok: true,
              output: { shard: 0, of: 1, sum: 0 },
              fuelUsed: 100,
              attestation: 'signed-by-nobody',
            })
          }
        }
        return decision
      }

      // A virtual clock whose ONLY source of advancement is the module's own `sleep`.
      // Nothing here waits on a real timer, so both arms are a deterministic sequence of
      // events rather than a race.
      //
      // **It has a horizon, and that is an instrument rather than a safety net.** An
      // unconditionally-renewed lease is not a slow test, it is a non-terminating one:
      // every wait here is a microtask, so a loop that renews forever never yields to
      // the macrotask queue and no test timeout can ever fire — the run hangs rather
      // than failing. Measured, on exactly that mutation. So the clock refuses to pass
      // its horizon and says why. The horizon is stated as a multiple of the module's
      // own `DEFAULT_LEASE_MS` rather than as a millisecond count, because it is virtual
      // time: it encodes no machine, no load and no I/O weather, only how many lease
      // spans this fixture is willing to call bounded.
      const HORIZON = DEFAULT_LEASE_MS * 10
      let t = 0
      const r = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [{ value: { n: 1 }, label: 'public' }],
          executors: [holder, honest(spareId)],
          nodes,
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
          admit,
        },
        new MemoryBlockstore(),
        {
          // CHURN-03 — this test asserts nothing about checkpointing.
          checkpoints: 'checkpoints-nothing',
          clock: {
            now: () => t,
            sleep: async (ms: number): Promise<void> => {
              t += ms
              if (t > HORIZON) {
                throw new Error(
                  `the lease clock passed ${HORIZON}ms of virtual time — this dispatch is not bounded by its lease`,
                )
              }
            },
          },
        },
      )
      if (!r.ok) throw new Error(`fixture submission failed: ${JSON.stringify(r.error)}`)
      return { job: r.job, holderId, spareId, probed, slotKey }
    }

    const present = await run(true)
    const gone = await run(false)

    // ── The outcome differs ──────────────────────────────────────────────────────
    const heldShard = present.job.shards[0] as ShardResult
    const movedShard = gone.job.shards[0] as ShardResult
    expect(heldShard.verification.status).toBe('agreed')
    if (heldShard.verification.status === 'agreed') {
      expect(heldShard.verification.agreeing.map((e) => e.nodeId)).toStrictEqual([present.holderId])
    }
    expect(movedShard.verification.status).toBe('agreed')
    if (movedShard.verification.status === 'agreed') {
      expect(movedShard.verification.agreeing.map((e) => e.nodeId)).toStrictEqual([gone.spareId])
    }
    expect(heldShard.attempted).toStrictEqual([present.holderId])
    expect(movedShard.attempted).toStrictEqual([gone.holderId, gone.spareId])
    expect(present.job.redispatches).toBe(0)
    expect(gone.job.redispatches).toBe(1)

    // ── And so does the HISTORY, which is where the route is visible ──────────────
    // Anti-vacuity: a shard can reach the same outcome by two routes, and the outcome
    // alone cannot tell a renewal from a lease that simply never came under pressure.
    const held = kinds(present.job.leaseHistory)
    const moved = kinds(gone.job.leaseHistory)
    expect(held.filter((k) => k === 'renewed').length).toBeGreaterThanOrEqual(1)
    expect(held).not.toContain('expired')
    expect(moved).not.toContain('renewed')
    expect(moved).toContain('expired')

    // ── The evidence was asked for on the task's OWN slot key ────────────────────
    // Derived in the module from `inputCid:partitionIndex`, exactly as `serveAgent`'s
    // exec branch derives what it reserves. A probe on the placement shard id (`'0'`)
    // would ask about a key no node ever holds and could never be evidence of anything.
    expect(present.slotKey).not.toBe('0')
    expect(present.probed).toContain(present.slotKey)
    expect(present.probed[0]).toBe('0')

    // WHAT THIS CANNOT REDDEN ON. It cannot say anything about a fabric where `admit` is
    // absent — that arm has no probe by construction and its lease always lapses, which
    // is stated on `JobSpec.admit` and is not measured here. It also cannot distinguish
    // one renewal from several: the count of `renewed` events depends on how many
    // microtask turns `executeVerified` needs after the holder answers, so the assertion
    // is `>= 1` deliberately rather than an exact number that would encode the runtime.
  })

  it('records nothing at all for a job in which nothing fails — the control', async () => {
    const ran: string[] = []
    const executors = ['w0', 'w1', 'w2'].map((nodeId) => watched(nodeId, ran))
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }, { value: { n: 2 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.job.complete).toBe(true)
    expect(r.job.redispatches).toBe(0)
    for (const shard of r.job.shards) {
      expect(shard.generations).toBe(1)
      expect(shard.ending).toBe('agreed')
      expect(shard.attempted).toHaveLength(2)
    }
    // Grants and completions, and nothing else. Without this the five readings above
    // could every one of them be describing a loop that retries unconditionally — a job
    // that re-dispatches everything also completes, also reaches full redundancy, and
    // also lands on a node the first placement did not choose.
    expect(new Set(kinds(r.job.leaseHistory))).toStrictEqual(new Set(['granted', 'completed']))
    expect(r.job.leaseHistory).toHaveLength(4)

    // WHAT THIS CANNOT REDDEN ON. Nothing about the retry policy itself: every trigger,
    // the bound and both renewal arms are unreachable on a fixture where nothing fails.
    // Its whole job is to falsify the *other* five, and it is worthless alone.
  })

  /**
   * The re-pick carries the refusal it moved on from — and the case above cannot see it.
   *
   * `re-places a refused shard onto an untried node` asserts `attempted` is `['n1','n2']`
   * and that `n2` agreed, which says *that* `n1` was asked and did not work out. It does
   * not read *why*, and until this case was written nothing did: `mergeVerifications`
   * collected every generation's `failures` and the `agreed` arm of `VerificationResult`
   * had nowhere to put them, so a re-pick that succeeded reported the success and erased
   * `n1`'s own words. Phase 6's rule is that every exclusion is named, because *"silent
   * filtering leaves a requestor unable to tell a dead network from a wrong clock from a
   * module nobody can run"* — and a retry that hides the reason is that same filtering
   * arriving one layer up, where a caller is least likely to look because the job
   * succeeded.
   *
   * The reason strings are deliberately distinctive, so finding one in a result means it
   * *travelled* rather than that it was reconstructed from a node id and a status.
   */
  const FIRST_REFUSAL = 'n1 refused: module feature set includes relaxed-simd'
  const SECOND_REFUSAL = 'n2 refused: clock skew 41s beyond tolerance'

  it('names the refusal it re-picked away from, beside a control that lost nobody', async () => {
    const build = (first: Executor): JobSpec => {
      const executors = [first, honest('n2'), honest('n3')]
      return {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      }
    }
    const store = (): Blockstore => new MemoryBlockstore()
    const opts: SubmitOptions = { checkpoints: 'checkpoints-nothing' }

    const retried = await submitJob(build(failing('n1', FIRST_REFUSAL)), store(), opts)
    // The control, in the SAME case and the same run: identical but for the refusal, so
    // the empty array below is a measurement rather than luck. Without it this case
    // passes against any implementation that puts something in the field.
    const clean = await submitJob(build(honest('n1')), store(), opts)

    expect(retried.ok && clean.ok).toBe(true)
    if (!retried.ok || !clean.ok) return
    const shard = retried.job.shards[0] as ShardResult
    const control = clean.job.shards[0] as ShardResult

    // The re-pick happened at all — otherwise there is no refusal to have lost.
    expect(shard.attempted).toStrictEqual(['n1', 'n2'])
    expect(shard.generations).toBe(control.generations + 1)
    expect(shard.ending).toBe('agreed')

    expect(shard.verification.status).toBe('agreed')
    expect(control.verification.status).toBe('agreed')
    if (shard.verification.status !== 'agreed' || control.verification.status !== 'agreed') return
    // The claim: not "a failure was recorded" but "n1's own words survived the re-pick".
    expect(shard.verification.failures).toStrictEqual([{ nodeId: 'n1', reason: FIRST_REFUSAL }])
    expect(control.verification.failures).toStrictEqual([])
    // And the answer is still reported — the refusal travels beside it, never over it.
    expect(shard.verification.agreeing.map((e) => e.nodeId)).toStrictEqual(['n2'])
  })

  it('unions every generation’s refusals rather than reporting only the most recent', async () => {
    // Two nodes refuse in turn before the third answers. An implementation that kept only
    // the latest generation's failures would lose `n1` while looking perfectly correct
    // about `n2` — which a single-refusal fixture cannot tell apart from the truth.
    const executors = [failing('n1', FIRST_REFUSAL), failing('n2', SECOND_REFUSAL), honest('n3')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.attempted).toStrictEqual(['n1', 'n2', 'n3'])
    expect(shard.generations).toBe(3)
    expect(shard.verification.status).toBe('agreed')
    if (shard.verification.status !== 'agreed') return
    // Generation order, earliest first, so a reader follows the refusals in the order the
    // fabric met them rather than having to sort them against `attempted`.
    expect(shard.verification.failures).toStrictEqual([
      { nodeId: 'n1', reason: FIRST_REFUSAL },
      { nodeId: 'n2', reason: SECOND_REFUSAL },
    ])
  })
})

/**
 * CHURN-02 / CHURN-06 — a straggler is duplicated, and the loser is still read.
 *
 * ## Every case here is deterministic, and this is how
 *
 * Nothing waits on wall time. The clock is the fixture's — `t` advances **only** when the
 * module itself sleeps — and slowness is a *deferred promise the fixture releases*, never
 * a delay. What the sleep additionally does is drain the microtask queue before it
 * resolves, and that is the load-bearing half: a `setTimeout(0)` fires as soon as the task
 * queue empties, so it measures no wall time at all, but every promise chain that was
 * ready has run to completion by the time the sleeper wakes. Without it, whether a losing
 * copy reads `agreed` or `uncompared` would depend on how many `await`s `executeVerified`
 * happens to contain — a number nobody has counted and nobody should have to.
 *
 * The clock also has a **horizon** and refuses to pass it, for the reason 20-01's renewal
 * fixture records: a loop that never terminates is not a slow test but a hung one, and a
 * named failure is worth more than a timeout. It is stated as a multiple of
 * `DEFAULT_LEASE_MS` because it is virtual time and encodes no machine.
 *
 * ## Which node gets the duplicate is derived, never chosen
 *
 * `speculativeCandidates` returns `eligibleNodes(request, pool)` minus everyone already
 * attempted, **in the pool's own order**, and this module takes the first. So the target
 * is a consequence of the fixture's node order and its sovereignty labels, and every case
 * below asserts the id that rule produces rather than one picked for the assertion.
 */
describe('CHURN-02/CHURN-06 — a straggler is duplicated, and the loser is still read', () => {
  /** `honest`'s own output, so a released copy answers exactly what a quick one would. */
  function agreeingOutput(task: Task): CanonicalValue {
    return { shard: task.partitionIndex, of: task.partitionCount, sum: task.partitionIndex * 10 }
  }

  /** `liar`'s, so a released copy answers something a comparison must reject. */
  function divergentOutput(task: Task): CanonicalValue {
    return { shard: task.partitionIndex, of: task.partitionCount, sum: 999 }
  }

  /**
   * Records WHICH node ran WHICH partition.
   *
   * The pair and not the node alone: a speculative copy is a *second run of one
   * partition*, so a bare node list cannot tell a duplicate from an ordinary placement,
   * and "speculation happened" would be read off the field under test.
   */
  function watched(nodeId: string, ran: string[], inner: Executor = honest(nodeId)): Executor {
    return {
      nodeId,
      async execute(task: Task): Promise<ExecutionOutcome> {
        ran.push(`${nodeId}#${task.partitionIndex}`)
        return inner.execute(task)
      },
    }
  }

  interface Held {
    readonly executor: Executor
    /** Answer now, with `output` over the task this executor was actually handed. */
    readonly release: () => void
  }

  /**
   * An executor that takes the work and then says nothing until the fixture lets it.
   *
   * A deferred promise rather than a delay: a delay is a race against whatever else the
   * run is doing, and every "slow" shard below is slow because it is *held*, which is a
   * fact the case states rather than one it hopes for.
   */
  function holding(
    nodeId: string,
    ran: string[],
    options: {
      readonly output?: (task: Task) => CanonicalValue
      /** Answer with a refusal instead of an output — the third thing a late copy can say. */
      readonly failWith?: string
      /** Run at the instant the work is handed over — the seam a release can hang on. */
      readonly onExecute?: () => void
    } = {},
  ): Held {
    let answer: ((outcome: ExecutionOutcome) => void) | null = null
    let handed: Task | null = null
    const work = new Promise<ExecutionOutcome>((resolve) => {
      answer = resolve
    })
    return {
      executor: {
        nodeId,
        execute(task: Task): Promise<ExecutionOutcome> {
          ran.push(`${nodeId}#${task.partitionIndex}`)
          handed = task
          options.onExecute?.()
          return work
        },
      },
      release: (): void => {
        if (answer === null || handed === null) return
        answer(
          options.failWith === undefined
            ? {
                ok: true,
                output: (options.output ?? agreeingOutput)(handed),
                fuelUsed: 100,
                attestation: 'signed-by-nobody',
              }
            : { ok: false, reason: options.failWith },
        )
      },
    }
  }

  /** Virtual time, plus a microtask drain. See this block's header for why both. */
  function fixtureClock(options: {
    readonly horizon: number
    /** Called with the new instant on every advance — where a timed release hangs. */
    readonly onAdvance?: (now: number) => void
  }): JobClock & { readonly reading: () => number } {
    let t = 0
    return {
      now: (): number => t,
      reading: (): number => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
        if (t > options.horizon) {
          throw new Error(
            `the clock passed ${options.horizon}ms of virtual time — this job is not bounded`,
          )
        }
        options.onAdvance?.(t)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
      },
    }
  }

  /** `n00`, `n01`, … — zero-padded so id order and numeric order are the same order. */
  function nodeName(index: number): string {
    return `n${String(index).padStart(2, '0')}`
  }

  /**
   * `count` public shards over `count` nodes at redundancy 1, one node per shard.
   *
   * The one-to-one mapping is `planPlacement`'s `dispatchCount` nudge doing what it
   * already did, not an arrangement this fixture imposes: every node starts at load 0, the
   * nudge adds one per placement, so shard `i` takes node `i` in id order.
   */
  function publicShards(count: number): readonly ShardSpec[] {
    return Array.from({ length: count }, (_, i): ShardSpec => ({ value: { n: i }, label: 'public' }))
  }

  /** The allowance a job of `shards` gets from a fraction — computed, never a literal. */
  function allowanceOf(shards: number, fraction = DEFAULT_SPECULATION_FRACTION): number {
    return Math.floor(shards * fraction)
  }

  it('duplicates a shard that has fallen behind its peers, onto a node the placement did not choose', async () => {
    // Ten shards so the default fraction yields an allowance at all, and nine of them
    // finish at once so the median has more than `MIN_SAMPLES` behind it. Only `n00`'s
    // shard is held.
    const ran: string[] = []
    const straggler = holding(nodeName(0), ran)
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? straggler.executor : watched(nodeName(i), ran),
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 10 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    expect(slow.speculated).toBe(true)
    // The duplicate's node, not merely that one happened. `n00` is running it and every
    // node is eligible for a public shard, so `speculativeCandidates` yields the pool
    // minus `n00` and this module takes the first — `n01`.
    expect(slow.attempted).toStrictEqual([nodeName(0), nodeName(1)])
    // And it RAN there, read off the executor rather than off the field under test.
    expect(ran).toContain(`${nodeName(1)}#0`)
    expect(ran).toContain(`${nodeName(0)}#0`)
    // One extra dispatch for the whole job, and it is this one.
    expect(ran).toHaveLength(11)
    expect(r.job.speculationSpent).toBe(1)
    expect(r.job.speculationMultiplier).toBeCloseTo(11 / 10, 12)
    // Nothing else was duplicated — the reading that separates "the tail was fixed" from
    // "everything was run twice", and the budget was exactly one anyway.
    expect(r.job.shards.filter((shard) => shard.speculated)).toHaveLength(1)
    expect(r.job.speculationSpent).toBe(allowanceOf(10))

    // WHAT THIS CANNOT REDDEN ON. Nothing about sovereignty: every shard here is public,
    // so `eligibleNodes` returns the whole pool and a duplicate cannot land anywhere it
    // should not have. It also says nothing about the budget — the allowance is 1 and one
    // duplicate was wanted, so a loop with no budget check at all passes this exactly.
  })

  it('takes the first answer, and it is the copy’s own bytes', async () => {
    // The held node would answer `sum: 0`; the rest of the pool answers `sum: 999`. So
    // the job's own result CID says which of the two copies it came from, rather than
    // being a value both could have produced.
    const ran: string[] = []
    const straggler = holding(nodeName(0), ran)
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? straggler.executor : watched(nodeName(i), ran, liar(nodeName(i))),
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 10 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    expect(slow.verification.status).toBe('agreed')
    if (slow.verification.status !== 'agreed') return
    // **This pair is load-bearing and was added after a plant.** Suppressing duplication
    // entirely left every other assertion below green, because a held node whose lease
    // lapses is re-dispatched onto exactly the same `n01` and answers exactly the same
    // bytes — the generation loop reaching the same place by the slower road. One
    // generation and a duplicate is what says a RACE decided this and not a timeout.
    expect(slow.speculated).toBe(true)
    expect(slow.generations).toBe(1)
    // WHO answered.
    expect(slow.verification.agreeing.map((replica) => replica.nodeId)).toStrictEqual([nodeName(1)])
    // And WHAT it answered — the copy's bytes, hashed independently here rather than
    // read back off the same field. The held node's own answer would be a different CID
    // and is asserted below to be different, so this is not a value both could give.
    const copysAnswer = await cidOf(divergentOutput({ ...task, partitionIndex: 0, partitionCount: 10 }))
    const stragglersAnswer = await cidOf(agreeingOutput({ ...task, partitionIndex: 0, partitionCount: 10 }))
    expect(slow.verification.resultCid.toString()).toBe(copysAnswer.toString())
    expect(copysAnswer.toString()).not.toBe(stragglersAnswer.toString())

    // WHAT THIS CANNOT REDDEN ON. It cannot say the loser was *read*: the held node never
    // answered at all here, so `copies` reports it uncompared and no comparison happened.
    // The two cases below are the ones that carry that, and only the second of them can.
  })

  it('reads a losing copy that agrees, and records it as compared rather than as absent', async () => {
    // The straggler is released the moment its duplicate is handed the work — a node that
    // was slow rather than gone, finishing just as the copy starts. It is one microtask
    // ahead of the copy at that point, so it wins the race and the COPY is the loser.
    const ran: string[] = []
    const straggler = holding(nodeName(0), ran, {
      onExecute: () => {
        // Only the second call is the duplicate's; the first is this node's own.
        if (ran.filter((entry) => entry.endsWith('#0')).length >= 2) straggler.release()
      },
    })
    const copyRuns: string[] = []
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      i === 0
        ? straggler.executor
        : watched(nodeName(i), ran, {
            nodeId: nodeName(i),
            async execute(shardTask: Task): Promise<ExecutionOutcome> {
              if (shardTask.partitionIndex === 0) {
                copyRuns.push(nodeName(i))
                straggler.release()
              }
              return honest(nodeName(i)).execute(shardTask)
            },
          }),
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 10 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    expect(slow.speculated).toBe(true)
    expect(copyRuns).toStrictEqual([nodeName(1)])
    // The straggler won its own race after all, so the COPY is the outstanding one.
    expect(slow.verification.status).toBe('agreed')
    if (slow.verification.status === 'agreed') {
      expect(slow.verification.agreeing.map((replica) => replica.nodeId)).toStrictEqual([nodeName(0)])
    }
    // It was READ. `'agreed'` and not `'uncompared'` is the whole reading: a loop that
    // dropped its losers would report the latter and every other assertion here would
    // still hold.
    expect(slow.copies).toStrictEqual([{ nodeIds: [nodeName(1)], outcome: 'agreed' }])
    expect(slow.disagreed).toBe(false)
    expect(r.job.complete).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. **It cannot redden on the comparison itself.** A loop
    // that compared nothing and hardcoded `'agreed'` passes this case exactly; so does one
    // that compares CIDs the wrong way round, since both copies answer the same bytes
    // here. The case below is the one that carries the comparison, and it is the
    // load-bearing case of this file.
  })

  it('reports a losing copy that answers DIFFERENTLY, names both CIDs, and fails the job', async () => {
    // Identical to the case above but for the copy's answer. The straggler answers
    // `sum: 0`, the copy answers `sum: 999`, and a comparison that happens finds it.
    const ran: string[] = []
    const straggler = holding(nodeName(0), ran)
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      i === 0
        ? straggler.executor
        : watched(nodeName(i), ran, {
            nodeId: nodeName(i),
            async execute(shardTask: Task): Promise<ExecutionOutcome> {
              if (shardTask.partitionIndex === 0) {
                straggler.release()
                return liar(nodeName(i)).execute(shardTask)
              }
              return honest(nodeName(i)).execute(shardTask)
            },
          }),
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 10 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    expect(slow.speculated).toBe(true)
    expect(slow.disagreed).toBe(true)
    // ── Anti-vacuity: the job fails, AND the shard names both answers ────────────────
    // A boolean alone is satisfiable by an unrelated failure, so the pair of CIDs is what
    // says a comparison took place and what it compared.
    expect(r.job.complete).toBe(false)
    expect(slow.verification.status).toBe('agreed')
    if (slow.verification.status !== 'agreed') return
    const winner = slow.verification.resultCid.toString()
    const loser = slow.copies[0]
    expect(loser?.outcome).toBe('disagreed')
    if (loser === undefined || loser.outcome !== 'disagreed') return
    expect(loser.nodeIds).toStrictEqual([nodeName(1)])
    expect(loser.resultCid).not.toBe(winner)
    // Both, hashed here rather than read back off the fields under test.
    const shardTask = { ...task, partitionIndex: 0, partitionCount: 10 }
    expect(winner).toBe((await cidOf(agreeingOutput(shardTask))).toString())
    expect(loser.resultCid).toBe((await cidOf(divergentOutput(shardTask))).toString())
    // The shards that never speculated are untouched by any of this.
    expect(r.job.shards.slice(1).every((shard) => !shard.disagreed)).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. It cannot distinguish *when* the comparison happened —
    // a loop that waited for its losers before returning the winner would also pass, at
    // the cost of the whole latency saving. Nothing here measures latency, deliberately:
    // an assertion about how long a race saved would encode this machine.
  })

  it('reports a copy that never answers as uncompared, which is not agreement', async () => {
    const ran: string[] = []
    const straggler = holding(nodeName(0), ran)
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? straggler.executor : watched(nodeName(i), ran),
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 10 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // A grace narrow enough that a copy nobody released cannot answer inside it, stated
      // as a knob rather than left to the default so the window is the case's own.
      { checkpoints: 'checkpoints-nothing', clock, speculation: { compareGraceMs: DEFAULT_SPECULATION_WATCHDOG_MS } },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    const left = slow.copies[0]
    expect(left?.outcome).toBe('uncompared')
    if (left === undefined || left.outcome !== 'uncompared') return
    // The held node is the one left over — the duplicate answered and won.
    expect(left.nodeIds).toStrictEqual([nodeName(0)])
    expect(left.reason).toContain('had not answered')
    // Three distinct readings, and the middle one is the point: silence is not agreement.
    expect(slow.disagreed).toBe(false)
    expect(left.outcome).not.toBe('agreed')
    expect(r.job.complete).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. It cannot catch a comparison that is simply never run:
    // a loop that reported every copy `uncompared` unconditionally passes this case. The
    // agreeing-loser case above is what says a copy can reach any other verdict.
  })

  it('gives a losing copy that answers with a FAILURE its own bucket, neither silent nor agreeing', async () => {
    // The fourth thing a leftover can turn out to be, and the one `coordinator.ts`
    // recorded as the hole: *"a copy that answered with a failure was neither silent nor
    // disagreeing, and every reader had to remember to consult a third structure that did
    // not exist."* Reachable only after another copy has already won, which is what this
    // fixture arranges — the held node is released with a refusal at a virtual instant the
    // watchdog's small hops never reach and the comparison window does.
    const RELEASED_AT = DEFAULT_LEASE_MS / 2
    const ran: string[] = []
    const straggler = holding(nodeName(0), ran, { failWith: 'this node gave up on the shard' })
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? straggler.executor : watched(nodeName(i), ran),
    )
    const clock = fixtureClock({
      horizon: DEFAULT_LEASE_MS * 10,
      onAdvance: (at) => {
        if (at >= RELEASED_AT) straggler.release()
      },
    })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // Wide enough that the release instant falls inside the window. Stated against the
      // lease rather than as a millisecond count: it is virtual time and encodes nothing
      // about this machine.
      { checkpoints: 'checkpoints-nothing', clock, speculation: { compareGraceMs: DEFAULT_LEASE_MS } },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    expect(slow.speculated).toBe(true)
    const left = slow.copies[0]
    expect(left?.outcome).toBe('failed')
    if (left === undefined || left.outcome !== 'failed') return
    expect(left.nodeIds).toStrictEqual([nodeName(0)])
    // In the refusing node's own words, carried rather than composed here.
    expect(left.reason).toContain('this node gave up on the shard')
    // Not silence and not disagreement — the two neighbouring readings, both denied.
    expect(slow.disagreed).toBe(false)
    expect(r.job.complete).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. It cannot separate a copy that failed from one that
    // failed *and was counted against the shard*: nothing here reads the shard's own
    // failure list, because `VerificationResult`'s `agreed` arm has no `failures` field to
    // read — an open question this plan inherited and did not close.
  })

  it('duplicates nothing before there is a tail — the control', async () => {
    // The identical shape with nothing held. Without this every reading above could be
    // describing unconditional duplication: a job that duplicates everything also
    // completes, also answers, and also lands a copy on a node the placement did not
    // choose.
    const ran: string[] = []
    const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
      watched(nodeName(i), ran),
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 10 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(10),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.job.speculationSpent).toBe(0)
    expect(r.job.speculationMultiplier).toBe(1)
    expect(r.job.shards.every((shard) => !shard.speculated)).toBe(true)
    expect(r.job.shards.every((shard) => shard.copies.length === 0)).toBe(true)
    // One dispatch per shard, and no more.
    expect(ran).toHaveLength(10)
    // Anti-vacuity: this fixture COULD have duplicated. The budget is not zero, so a
    // reading of `spent: 0` is a statement about the tail rather than about the allowance.
    expect(allowanceOf(10)).toBeGreaterThan(0)

    // WHAT THIS CANNOT REDDEN ON. Nothing about what a duplicate does once started — the
    // race, the comparison and the sovereignty gate are all unreachable here. Its whole
    // job is to falsify the others.
    //
    // It also cannot redden on `MIN_SAMPLES`, and that is why the case below exists:
    // nothing here is slow, so the floor is never the reason nothing was duplicated.
  })

  /**
   * The floor `stragglers` applies BEFORE it computes a median at all — closing the row
   * 20-07 recorded as NOT COVERED, written by 20-12 as the condition of deleting
   * `coordinator.test.ts` › `does not duplicate before enough shards have finished to
   * compare against`.
   *
   * `stragglers` returns `[]` while `completed.length < MIN_SAMPLES`, however long a task
   * has been running. `speculation.test.ts` asserts that against `stragglers` directly;
   * until now **nothing asserted it through `submitJob`**, and the composition is a
   * different claim — `submit.ts` supplies `completed` and omits `minSamples`, so a caller
   * that accumulated durations wrongly, or passed a `minSamples` of its own, would be
   * invisible to the unit case.
   *
   * ## Why a PAIR and not a single arm
   *
   * `speculationSpent: 0` has three causes and this block already reads two of them: the
   * allowance was zero (a job under ten shards), and nothing was slow (the control above).
   * The floor is the third, and no single arm can tell it from the other two. So the two
   * arms differ in **one integer** — how many shards answer at once — and are identical in
   * shard count, node count, budget, held span and release instant. The comparison is
   * taken inside one run, per `CLAUDE.md` § Measurement.
   */
  it('duplicates nothing until MIN_SAMPLES shards have finished — one fixture, two arms differing only in how many did', async () => {
    const TOTAL = 10
    /** Past every watchdog hop, and short of `DEFAULT_LEASE_MS` so no lease lapses. */
    const RELEASED_AT = DEFAULT_LEASE_MS * (2 / 3)

    async function run(
      quick: number,
    ): Promise<{ readonly job: JobResult; readonly ran: readonly string[] }> {
      const ran: string[] = []
      const held: Held[] = []
      const executors: readonly Executor[] = Array.from({ length: TOTAL }, (_, i) => {
        if (i < quick) return watched(nodeName(i), ran)
        const slow = holding(nodeName(i), ran)
        held.push(slow)
        return slow.executor
      })
      const clock = fixtureClock({
        horizon: DEFAULT_LEASE_MS * 10,
        onAdvance: (at) => {
          if (at >= RELEASED_AT) for (const slow of held) slow.release()
        },
      })
      const r = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: publicShards(TOTAL),
          executors,
          nodes: publicNodes(executors),
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        new MemoryBlockstore(),
        { checkpoints: 'checkpoints-nothing', clock },
      )
      if (!r.ok) throw new Error(`fixture submission failed: ${JSON.stringify(r.error)}`)
      return { job: r.job, ran }
    }

    const below = await run(MIN_SAMPLES - 1)
    const at = await run(MIN_SAMPLES)

    // ── Below the floor: held shards, an unspent budget, and still no duplicate ───────
    expect(below.job.speculationSpent).toBe(0)
    expect(below.job.shards.every((shard) => !shard.speculated)).toBe(true)
    // Read off the executors rather than off the field under test: one dispatch per shard
    // and not one more. A duplicate started and then lost would still appear here.
    expect(below.ran).toHaveLength(TOTAL)

    // ── At the floor: the same fixture, one shard more finished, and it duplicates ────
    expect(at.job.speculationSpent).toBe(allowanceOf(TOTAL))
    expect(at.job.shards.filter((shard) => shard.speculated)).toHaveLength(allowanceOf(TOTAL))
    expect(at.ran).toHaveLength(TOTAL + allowanceOf(TOTAL))

    // ── The arms are comparable, stated rather than assumed ──────────────────────────
    // The budget is the same and is not zero in EITHER arm, so `spent: 0` above is a
    // statement about the floor and not about the allowance.
    expect(allowanceOf(TOTAL)).toBeGreaterThan(0)
    // And both arms hold more shards than the budget could ever duplicate, so neither
    // reading is the supply of stragglers running out.
    expect(TOTAL - (MIN_SAMPLES - 1)).toBeGreaterThan(allowanceOf(TOTAL))
    expect(TOTAL - MIN_SAMPLES).toBeGreaterThan(allowanceOf(TOTAL))
    // Both jobs finished on their answers, so neither arm is reading a job that failed.
    expect(below.job.complete).toBe(true)
    expect(at.job.complete).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. It cannot separate the floor from the *median*: a
    // threshold computed from a one-sample median would also duplicate nothing in the
    // `below` arm. `speculation.test.ts` holds the median; what this adds is that
    // `submitJob` feeds the floor a real `completed` list rather than a constant.
    // It also says nothing about WHICH shard got the duplicate — the same deliberate
    // silence the budget case keeps, and for the same reason.
  })

  it('scopes a sovereign duplicate to its owner, and starts none where the owner has no spare', async () => {
    // Two owners in ONE job, so the pair is read in one run against one budget: alice has
    // a spare node and carol does not. Both their shards are held; five public shards
    // finish at once and supply the median.
    const ran: string[] = []
    const alicesOwn = holding('alice-1', ran)
    const carolsOnly = holding('carol-1', ran)
    const nodes: readonly NodeDescriptor[] = [
      { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'alice-2', ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: 'carol-1', ownerId: 'carol', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      ...['bob-1', 'bob-2', 'bob-3', 'bob-4', 'bob-5'].map(
        (nodeId): NodeDescriptor => ({
          nodeId,
          ownerId: 'bob',
          canExecuteSovereign: true,
          load: 0,
          certificate: 'carries-no-certificate',
        }),
      ),
    ]
    const executors: readonly Executor[] = [
      alicesOwn.executor,
      watched('alice-2', ran),
      carolsOnly.executor,
      ...['bob-1', 'bob-2', 'bob-3', 'bob-4', 'bob-5'].map((nodeId) => watched(nodeId, ran)),
    ]
    const shards: readonly ShardSpec[] = [
      { value: { n: 0 }, label: 'sovereign', ownerId: 'alice' },
      { value: { n: 1 }, label: 'sovereign', ownerId: 'carol' },
      ...Array.from({ length: 5 }, (_, i): ShardSpec => ({ value: { n: 100 + i }, label: 'public' })),
    ]
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 20 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards,
        executors,
        nodes,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // A budget large enough that carol's shard is refused a duplicate by the
      // ELIGIBILITY gate and not by the allowance. Without this the two refusals are
      // indistinguishable and the case is vacuous.
      { checkpoints: 'checkpoints-nothing', clock, speculation: { fraction: 1 } },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return

    // ── Alice: a spare of her own, and the copy went there ───────────────────────────
    const alices = r.job.shards[0] as ShardResult
    expect(alices.speculated).toBe(true)
    expect(alices.attempted).toStrictEqual(['alice-1', 'alice-2'])
    expect(ran).toContain('alice-2#0')

    // ── Carol: none, so none was started, and nothing foreign was asked ──────────────
    const carols = r.job.shards[1] as ShardResult
    expect(carols.speculated).toBe(false)
    expect(carols.copies).toStrictEqual([])
    // The anti-vacuity read, and the one that could catch a widened pool: the owner's own
    // node and nobody else, taken off `attempted` AND off the executors' own record. A
    // reason string stays perfectly plausible while the shard runs on bob.
    expect(carols.attempted).toStrictEqual(['carol-1'])
    expect(ran.filter((entry) => entry.endsWith('#1'))).toStrictEqual(['carol-1#1'])
    // And it was the GATE that refused, not the budget: one duplicate was spent out of an
    // allowance of seven.
    expect(r.job.speculationSpent).toBe(1)
    expect(allowanceOf(shards.length, 1)).toBeGreaterThan(1)

    // WHAT THESE CANNOT REDDEN ON. Alice's arm cannot catch a widened pool: with every
    // node at load 0 the order is the pool's own and `alice-2` precedes every `bob-*`, so
    // a duplicate chosen from the whole node set would land there anyway. **Carol's arm
    // is the one that can** — and it catches a candidate set built from the job's nodes
    // instead of from `speculativeCandidates`. It does NOT catch handing
    // `speculativeCandidates` a wider *pool*: that function calls `eligibleNodes` on
    // whatever it is given, so widening its input cannot widen its output. That guarantee
    // is `sovereignty.ts`'s and is asserted there.
  })

  it('spends no more than the job-wide budget, however many shards are slow', async () => {
    // Twenty shards, fifteen of them held. Five finish at once and supply the median, so
    // every one of the fifteen is a straggler by the same rule — and the number that get
    // a duplicate is the allowance and nothing else.
    const total = 20
    const quick = 5
    const ran: string[] = []
    const executors: readonly Executor[] = Array.from({ length: total }, (_, i) =>
      i < quick ? watched(nodeName(i), ran) : holding(nodeName(i), ran).executor,
    )
    const clock = fixtureClock({ horizon: DEFAULT_LEASE_MS * 100 })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: publicShards(total),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Against the fraction, computed. A literal here would be a number that stops
    // describing the rule the moment the fraction moves.
    expect(r.job.speculationSpent).toBe(allowanceOf(total))
    expect(r.job.shards.filter((shard) => shard.speculated)).toHaveLength(allowanceOf(total))
    // Anti-vacuity in the other direction: far more shards were slow than were duplicated,
    // so the bound bit rather than the supply of stragglers running out.
    expect(total - quick).toBeGreaterThan(allowanceOf(total))
    expect(r.job.speculationMultiplier).toBeCloseTo((total + allowanceOf(total)) / total, 12)

    // WHAT THIS CANNOT REDDEN ON. It cannot say WHICH shards were duplicated, and that is
    // deliberate: which straggler ticks first is a fact about the scheduler, and an
    // assertion on it would be an assertion about microtask order.
  })

  it('turns off to the identity — the same fixture, one dispatch per shard and a multiplier of 1', async () => {
    // ONE fixture read twice. The held node answers once virtual time passes `RELEASED_AT`
    // — which the watchdog's small hops never reach, and which the single sleep-to-the-
    // deadline of a job that is not watching passes on its first wait. So the difference
    // between the arms is speculation and nothing else about the fixture.
    const RELEASED_AT = DEFAULT_LEASE_MS * (2 / 3)
    async function run(
      speculation: SubmitOptions['speculation'],
    ): Promise<{ readonly job: JobResult; readonly ran: readonly string[] }> {
      const ran: string[] = []
      const straggler = holding(nodeName(0), ran)
      const executors: readonly Executor[] = Array.from({ length: 10 }, (_, i) =>
        i === 0 ? straggler.executor : watched(nodeName(i), ran),
      )
      const clock = fixtureClock({
        horizon: DEFAULT_LEASE_MS * 10,
        onAdvance: (at) => {
          if (at >= RELEASED_AT) straggler.release()
        },
      })
      const r = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: publicShards(10),
          executors,
          nodes: publicNodes(executors),
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        new MemoryBlockstore(),
        // CHURN-03 — this fixture asserts nothing about checkpointing, and it says so on
        // both arms rather than only on the one it happens to take.
        speculation === undefined
          ? { clock, checkpoints: 'checkpoints-nothing' }
          : { clock, speculation, checkpoints: 'checkpoints-nothing' },
      )
      if (!r.ok) throw new Error(`fixture submission failed: ${JSON.stringify(r.error)}`)
      return { job: r.job, ran }
    }

    const on = await run(undefined)
    const off = await run('duplicates-no-stragglers')

    // ── The off arm: the identity, and nothing extra was dispatched ──────────────────
    // The PAIR is what distinguishes disabled from idle. A multiplier of 1 alone is also
    // what a job with no stragglers reports, so it is read beside a dispatch count that
    // equals the placed count — computed off `attempted`, never written as a literal.
    expect(off.job.speculationMultiplier).toBe(1)
    expect(off.job.speculationSpent).toBe(0)
    const placed = off.job.shards.reduce((n, shard) => n + shard.attempted.length, 0)
    expect(off.ran).toHaveLength(placed)
    expect(off.job.shards.every((shard) => !shard.speculated && shard.copies.length === 0)).toBe(true)
    expect(off.job.complete).toBe(true)

    // ── Comparative, inside one case: the same fixture with it on costs one more ─────
    expect(on.ran).toHaveLength(off.ran.length + 1)
    expect(on.job.speculationSpent).toBe(1)
    expect(on.job.speculationMultiplier).toBeGreaterThan(off.job.speculationMultiplier)
    expect((on.job.shards[0] as ShardResult).speculated).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. It cannot catch a switch that turns off more than
    // speculation: both arms answer, so an off arm that had also disabled the lease
    // deadline would pass. 20-01's renewal pair is what holds the deadline.
  })
})

/**
 * VER-03 / VER-04 — the strictness dial, proved to be a dial and proved to be required.
 *
 * **These cases are deliberately thin, and the thinness is the honest part.** Nothing
 * reads `onQuorumShortfall` yet: Plan 19-06 is where an uncomposable quorum starts
 * consulting it. So the only claims available here are that the two arms are
 * distinguishable *as values* and survive the submission path unchanged, and that the
 * field cannot be left out. Restating 19-06's behavioural cases here would be a second
 * file claiming a proof it does not carry.
 *
 * The omission case is the one this whole plan exists for. It cannot be exercised at
 * runtime — "a spec without the dial fails `tsc --noEmit`" is a fact about the type
 * checker, not about the program — so `@ts-expect-error` is what turns it into
 * something every `npx tsc --noEmit` re-verifies. The same instrument
 * `agent-contract.test.ts` uses on `AgentOptions`' eight required hooks, for the same
 * reason and against the same recorded defect: Plans 19-01 and 19-13 each made a field
 * optional and omitted it, and each watched `tsc --noEmit` exit 0 while the behaviour
 * they were asserting was wrong. If this field is ever widened back to optional, the
 * omission stops being an error and the suppression becomes an "Unused
 * '@ts-expect-error' directive" error — so the guard fails in the direction that
 * matters instead of quietly agreeing with whatever the type allows.
 */
describe('VER-03/VER-04 — a job cannot be submitted without saying what an uncomposable quorum should do', () => {
  const dialNodes: readonly NodeDescriptor[] = [
    { nodeId: 'd-a', ownerId: 'public', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    { nodeId: 'd-b', ownerId: 'public', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
  ]

  /**
   * The two specs differ in exactly one property. No arm is a parameter default here —
   * every caller of this helper passes one, which is the same discipline the tree is
   * held to.
   */
  function specWith(onQuorumShortfall: JobSpec['onQuorumShortfall']): JobSpec {
    return {
      moduleCid: MODULE_CID,
      shards: [{ value: { n: 1 }, label: 'public' }],
      executors: dialNodes.map((n) => honest(n.nodeId)),
      nodes: dialNodes,
      redundancy: 2,
      onQuorumShortfall,
    }
  }

  it('carries the degrade arm through submission unchanged', async () => {
    const spec = specWith('runs-at-available-redundancy')
    expect(spec.onQuorumShortfall).toBe('runs-at-available-redundancy')
    const r = await submitJob(spec, new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Stated as an unchanged reading rather than a new one: this plan adds no
    // behaviour, so a shard that agreed at full redundancy before the dial existed
    // still does.
    expect(r.job.shards[0]?.verification.status).toBe('agreed')
    expect(r.job.shards[0]?.degraded).toBe(false)
  })

  it('carries the refuse arm through submission unchanged, because nothing reads it yet', async () => {
    const spec = specWith('refuses-the-shard')
    expect(spec.onQuorumShortfall).toBe('refuses-the-shard')
    const r = await submitJob(spec, new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The same reading as the degrade arm above, and that identity is the claim:
    // until Plan 19-06 wires it, the arms are values the path carries and nothing
    // branches on. A divergence here would mean this plan changed behaviour it said
    // it would not.
    expect(r.job.shards[0]?.verification.status).toBe('agreed')
    expect(r.job.shards[0]?.degraded).toBe(false)
  })

  it('holds the two arms apart as values', () => {
    expect(specWith('runs-at-available-redundancy').onQuorumShortfall).not.toBe(
      specWith('refuses-the-shard').onQuorumShortfall,
    )
  })

  it('fails to compile with onQuorumShortfall omitted', async () => {
    const full = specWith('runs-at-available-redundancy')
    const { onQuorumShortfall: _unused, ...rest } = full
    // @ts-expect-error VER-03 — onQuorumShortfall is required; omitting it must fail `tsc --noEmit`, naming 'onQuorumShortfall'.
    const r = await submitJob(rest, new MemoryBlockstore(), {
      // CHURN-03 — supplied so the *only* thing wrong with this call is the omission
      // under test. Until 2026-08-05 the third argument could be dropped entirely and
      // this case passed two arguments; it then read `undefined.clock` and threw, which
      // is how the required-options change first announced itself here.
      checkpoints: 'checkpoints-nothing',
    })
    // The submission still runs: nothing reads the field, so the omission is a
    // compile-time refusal and nothing else. The runtime assertion is here only so
    // the case is a test rather than a comment.
    expect(r.ok).toBe(true)
  })
})

/**
 * CHURN-03 — the type-level half of the 2026-08-05 ruling on
 * `SubmitOptions.checkpoints`.
 *
 * The scope guard (`packages/node/src/checkpoint-optout-scope.node.test.ts`) pins *which*
 * files opt out. It cannot see the thing that made opting out a written act in the first
 * place, because that is a property of the type and a type produces no runtime evidence.
 * These two cases are that evidence, in the idiom the `onQuorumShortfall` case above
 * established: `@ts-expect-error` fails `tsc --noEmit` if the error it claims stops
 * happening, so a silent revert to `checkpoints?:` reddens the build rather than passing
 * quietly.
 *
 * **This proves the field is required. It proves nothing about anything writing a
 * checkpoint** — no production submitter supplies a real sink, and ROADMAP criterion 7 is
 * PARTIAL for exactly that reason.
 */
describe('CHURN-03 — a job cannot be submitted without saying whether it checkpoints', () => {
  /** The smallest spec that submits successfully, so the only variable is the options bag. */
  function oneShard(): JobSpec {
    const executors = [honest('a')]
    return {
      moduleCid: MODULE_CID,
      shards: [{ value: { n: 1 }, label: 'public' }],
      executors,
      nodes: publicNodes(executors),
      redundancy: 1,
      onQuorumShortfall: 'runs-at-available-redundancy',
    }
  }

  it('fails to compile with the options bag omitted entirely', async () => {
    const spec = oneShard()
    // @ts-expect-error CHURN-03 — the options bag is required, because a bag that may be
    // omitted cannot carry a mandatory field: this call is the silence the ruling removed.
    const submitted = submitJob(spec, new MemoryBlockstore())
    // It rejects rather than resolving: `submitJob` reads `options.clock` before it does
    // anything else, so the omitted bag is a throw and not a refusal with a name. Asserted
    // rather than swallowed, so this case is a test and not a comment.
    await expect(submitted).rejects.toThrow(TypeError)
  })

  it('fails to compile with an options bag that omits checkpoints', async () => {
    const spec = oneShard()
    const submitted = submitJob(
      spec,
      new MemoryBlockstore(),
      // @ts-expect-error CHURN-03 — `checkpoints` is required; a caller that keeps none
      // must write `'checkpoints-nothing'` rather than leave the question unanswered.
      {},
    )
    // **Recorded because it was measured and it surprised the change that caused it.**
    // The expectation written here first was `r.ok === true` — that an omitted field
    // would still reach `NO_CHECKPOINTS`, as it did while the field was optional. It does
    // not. The consuming branch now tests for the sentinel *positively*, so an untyped
    // `undefined` falls to the sink arm and `checkpointLogOf` throws on the first
    // settling shard: `TypeError: Cannot read properties of undefined (reading 'publish')`.
    //
    // That is the honest reading and it is the better one, but note what it is: the two
    // arms are no longer interchangeable at runtime *either*, so a JavaScript caller — or
    // anything that reaches here past a deliberate `@ts-expect-error`, which is the only
    // way in — fails loudly rather than quietly keeping no checkpoints. It fails mid-job
    // rather than at entry, which is a worse instant than an early refusal would be. No
    // runtime validation was added for it, following the precedent of `onQuorumShortfall`
    // one describe up: a field required by the type is not re-checked at run time here,
    // and inventing a new `SubmitError` for an unreachable case is a wider change than
    // this ruling authorised.
    await expect(submitted).rejects.toThrow(TypeError)
  })

  it('accepts the sentinel, and the sentinel is spelled the way the fabric spells its others', () => {
    // Not a tautology over a literal: it pins the *spelling* against the idiom
    // `'duplicates-no-stragglers'`, `'serves-unauthenticated'` and `'admits-any-peer'`
    // share, which is what `checkpoint-optout-scope.node.test.ts` greps for. A rename
    // that missed that file would leave the scope guard scanning for a string nothing
    // says — passing while pinning nothing.
    const options: SubmitOptions = { checkpoints: 'checkpoints-nothing' }
    expect(options.checkpoints).toBe('checkpoints-nothing')
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
      onQuorumShortfall: 'runs-at-available-redundancy',
      admit: (offer: Offer): Admission => {
        first ??= offer.nodeId
        return { accepted: true, capacity: 'states-no-capacity' }
      },
    },
    new MemoryBlockstore(),
    // CHURN-03 — this test asserts nothing about checkpointing.
    { checkpoints: 'checkpoints-nothing' },
  )
  return first
}

// ---------------------------------------------------------------------------
// VER-03, VER-04, VER-08, VER-09, VER-10 — the quorum on the path and the
// receipt on the result.
// ---------------------------------------------------------------------------

/**
 * Real identities, because the subject of every case below is a **checked signature**.
 *
 * Nothing in production signs at the wave this file was written — Plan 19-15 composes
 * the signing wrapper at the two node factories — so these fixtures sign directly
 * through `result-attestation.ts`, which is the level this plan's claims live at
 * anyway. `submitJob` reads the wall clock to judge a certificate's validity window,
 * so the authority issues at `Date.now()` rather than at a pinned epoch: a fixture
 * certificate minted for some other instant would be refused as expired or not-yet-valid
 * and every case here would read the named absence for a reason that has nothing to do
 * with what it is testing.
 */
const PROVIDER_KEY = new Uint8Array(32).fill(19)
const OTHER_PROVIDER_KEY = new Uint8Array(32).fill(21)
const OWNER_KEY = new Uint8Array(32).fill(20)

function authorityFor(providerPrivateKey: Uint8Array): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey,
    maxPerWindow: 50,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
}

interface Enrolled {
  readonly nodeId: string
  readonly signer: ResultSigner
  readonly certificate: NodeCertificate
}

/** Distinct node seeds, so no two fixture nodes share a key by accident. */
let nodeSeedCounter = 100

function enrol(
  nodeId: string,
  operatorId: string,
  relayIds: readonly string[],
  providerPrivateKey: Uint8Array = PROVIDER_KEY,
  issuedAt: number = Date.now(),
): Enrolled {
  nodeSeedCounter += 1
  const nodeSeed = new Uint8Array(32).fill(nodeSeedCounter)
  const issued = authorityFor(providerPrivateKey).enrol(
    requestEnrollment(nodeSeed, OWNER_KEY, { operatorId, discoverability: 'via-relay', relayIds }),
    issuedAt,
  )
  if (!issued.ok) throw new Error(`fixture failed to enrol ${nodeId}: ${JSON.stringify(issued.refusal)}`)
  return { nodeId, signer: { nodeSeed, certificate: issued.certificate }, certificate: issued.certificate }
}

/**
 * A node that binds a socket: `discoverability: 'seed'`, no relay dependency of its own.
 *
 * Separate from {@link enrol} rather than an extra parameter on it, because `enrol`'s
 * trailing arguments are positional and every existing call passes `relayIds` third — a
 * `discoverability` parameter would have to go fourth, ahead of `providerPrivateKey`, and
 * silently reinterpret the two call sites that pass it. VER-03's second arm is the only
 * thing that needs a seed here, and it needs it to be one that is *named* by other
 * members, which is what `nodeId` supplies.
 */
function enrolSeed(nodeId: string, operatorId: string): Enrolled {
  nodeSeedCounter += 1
  const nodeSeed = new Uint8Array(32).fill(nodeSeedCounter)
  const issued = authorityFor(PROVIDER_KEY).enrol(
    requestEnrollment(nodeSeed, OWNER_KEY, { operatorId, discoverability: 'seed', relayIds: [] }),
    Date.now(),
  )
  if (!issued.ok) throw new Error(`fixture failed to enrol ${nodeId}: ${JSON.stringify(issued.refusal)}`)
  return { nodeId, signer: { nodeSeed, certificate: issued.certificate }, certificate: issued.certificate }
}

function descriptorFor(node: Enrolled, ownerId = 'public', load = 0): NodeDescriptor {
  return { nodeId: node.nodeId, ownerId, canExecuteSovereign: true, load, certificate: node.certificate }
}

/** The shared answer, so replicas of one shard agree on the result they are attesting. */
function answerFor(task: Task): CanonicalValue {
  return { shard: task.partitionIndex, of: task.partitionCount, sum: task.partitionIndex * 10 }
}

async function cidOf(value: CanonicalValue): Promise<CID> {
  const hashed = await canonicalCid(value)
  if (!hashed.ok) throw new Error('fixture value not encodable')
  return hashed.cid
}

/** An honest executor that signs what it produced, as a real enrolled node would. */
function signing(node: Enrolled, signer: ResultSigner = node.signer): Executor {
  return {
    nodeId: node.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      const output = answerFor(task)
      return {
        ok: true,
        output,
        fuelUsed: 100,
        attestation: signResult(signer, {
          moduleCid: task.moduleCid,
          inputCid: task.inputCid,
          partitionIndex: task.partitionIndex,
          outputCid: await cidOf(output),
        }),
      }
    },
  }
}

/**
 * An executor that returns the agreed answer and signs a **different** one.
 *
 * The replica agrees — the outputs matched, so it is in `agreeing` — and its statement
 * is about something else. That is the whole third leg: a certificate counts because a
 * signature over *this* result checked out, not because the node was in the set.
 */
function signingSomethingElse(node: Enrolled): Executor {
  return {
    nodeId: node.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      return {
        ok: true,
        output: answerFor(task),
        fuelUsed: 100,
        attestation: signResult(node.signer, {
          moduleCid: task.moduleCid,
          inputCid: task.inputCid,
          partitionIndex: task.partitionIndex,
          outputCid: await cidOf({ some: 'other output' }),
        }),
      }
    },
  }
}

describe('VER-08/VER-09/VER-10 — every shard says how strongly it was attested', () => {
  it('reads owner-attested when one verified replica ran it', async () => {
    const solo = enrol('solo', 'op-solo', ['relay-solo'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(solo)],
        nodes: [descriptorFor(solo)],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const attestation = (r.job.shards[0] as ShardResult).attestation
    expect(attestation).toMatchObject({ strength: 'owner-attested', replicas: 1 })
    expect(r.job.attestation).toMatchObject({ strength: 'owner-attested' })
  })

  it('reads owner-domain when two verified replicas share an operator', async () => {
    const one = enrol('bob-1', 'op-bob', ['relay-1'])
    const two = enrol('bob-2', 'op-bob', ['relay-2'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'bob' }],
        executors: [signing(one), signing(two)],
        nodes: [descriptorFor(one, 'bob'), descriptorFor(two, 'bob')],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.job.shards[0] as ShardResult).attestation).toMatchObject({
      strength: 'owner-domain',
      replicas: 2,
      operators: ['op-bob'],
    })
  })

  it('reads independent when two verified replicas answer under different operators', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signing(b)],
        nodes: [descriptorFor(a), descriptorFor(b)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.job.shards[0] as ShardResult).attestation).toMatchObject({
      strength: 'independent',
      replicas: 2,
      operators: ['op-a', 'op-b'],
    })
  })

  it('excludes a replica whose signature is over a different output, and says so', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signingSomethingElse(b)],
        nodes: [descriptorFor(a), descriptorFor(b)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    // The two agreed — this is not a disagreement — and the requestor still cannot
    // account for one of them.
    expect(shard.verification.status).toBe('agreed')
    expect(shard.attestation).toMatchObject({
      kind: 'holds-no-verified-attestation',
      agreeing: 2,
      verified: 1,
    })
    expect(shard.attestation).not.toMatchObject({ strength: 'independent' })
    if ('kind' in shard.attestation) {
      expect(shard.attestation.reason).toContain('did not sign this output')
    }
  })

  it('excludes a replica answering under a certificate this requestor did not place with', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    // `b`'s second identity: its own certificate, from the same provider, naming an
    // operator this requestor never placed anything with.
    const bElsewhere = enrol('b', 'op-elsewhere', ['relay-b'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signing(b, bElsewhere.signer)],
        nodes: [descriptorFor(a), descriptorFor(b)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.attestation).toMatchObject({
      kind: 'holds-no-verified-attestation',
      agreeing: 2,
      verified: 1,
    })
    if ('kind' in shard.attestation) {
      expect(shard.attestation.reason).toContain('discovered under')
    }
  })

  it('accepts a node that re-enrolled between discovery and execution', async () => {
    // Same node key, a fresher certificate from the same provider. Byte equality would
    // refuse an honest node for having renewed; `nodeKey` plus the pinned issuer accepts
    // it.
    const a = enrol('a', 'op-a', ['relay-a'], PROVIDER_KEY, Date.now() - 60_000)
    const renewed = authorityFor(PROVIDER_KEY).enrol(
      requestEnrollment(a.signer.nodeSeed, OWNER_KEY, {
        operatorId: 'op-a',
        discoverability: 'via-relay',
        relayIds: ['relay-a', 'relay-a2'],
      }),
      Date.now(),
    )
    expect(renewed.ok).toBe(true)
    if (!renewed.ok) return

    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a, { nodeSeed: a.signer.nodeSeed, certificate: renewed.certificate })],
        nodes: [descriptorFor(a)],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.job.shards[0] as ShardResult).attestation).toMatchObject({
      strength: 'owner-attested',
      replicas: 1,
    })
  })

  it('builds the receipt from the replicas that agreed, never from the nodes that were placed', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    const c = enrol('c', 'op-c', ['relay-c'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signing(b), failing('c', 'disk gave out')],
        nodes: [descriptorFor(a), descriptorFor(b), descriptorFor(c)],
        redundancy: 3,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    // Three were placed; two attested. A node that was asked and failed said nothing.
    expect(shard.attestation).toMatchObject({ strength: 'independent', replicas: 2 })
    if ('strength' in shard.attestation) {
      expect(shard.attestation.operators).not.toContain('op-c')
    }
  })

  it('states the absence rather than defaulting to owner-attested when nobody signed', async () => {
    // Every caller building descriptors through `publicNodes` lands here, and the
    // honest answer is that this requestor holds no signed statement about the result —
    // which is a different claim from the weakest strength, not a weaker version of it.
    const executors = [honest('n1'), honest('n2')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    expect(shard.attestation).toMatchObject({
      kind: 'holds-no-verified-attestation',
      agreeing: 2,
      verified: 0,
    })
    expect(shard.attestation).not.toMatchObject({ strength: 'owner-attested' })
    expect(r.job.attestation).toMatchObject({ kind: 'holds-no-verified-attestation' })
  })

  it('reports a shard that never agreed as holding no attestation, not as owner-attested', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [failing(a.nodeId, 'nothing left to give')],
        nodes: [descriptorFor(a)],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.job.shards[0] as ShardResult).attestation).toMatchObject({
      kind: 'holds-no-verified-attestation',
      agreeing: 0,
      verified: 0,
    })
  })

  it('reports the job at its weakest shard, not its strongest and not its first', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    // Alice holds one node, so her sovereign shard runs once — owner-attested. The
    // public shard ahead of it agrees across two operators — independent.
    const alice = enrol('alice-1', 'op-alice', ['relay-alice'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [
          { value: { n: 1 }, label: 'public' },
          { value: { n: 2 }, label: 'sovereign', ownerId: 'alice' },
        ],
        executors: [signing(a), signing(b), signing(alice)],
        nodes: [descriptorFor(a), descriptorFor(b), descriptorFor(alice, 'alice')],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.job.shards[0] as ShardResult).attestation).toMatchObject({ strength: 'independent' })
    expect((r.job.shards[1] as ShardResult).attestation).toMatchObject({ strength: 'owner-attested' })
    // The first shard is the strong one, so "first" and "strongest" both read
    // `independent` here and only "weakest" reads this.
    expect(r.job.attestation).toMatchObject({ strength: 'owner-attested' })
  })
})

/**
 * VER-03 / VER-04 — the quorum on the submission path, and the dial that decides what
 * an uncomposable one costs.
 *
 * **The same one-operator fabric appears in two of these cases and produces opposite
 * outcomes.** That is the point: the only thing that differs between them is
 * `onQuorumShortfall`, so nothing else can be what decided.
 */
describe('VER-03/VER-04 — a public shard wanting verification gets a composed quorum, or the caller’s answer', () => {
  it('composes across two operators on independent paths, and the shard is not degraded', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signing(b)],
        nodes: [descriptorFor(a), descriptorFor(b)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.quorum).toMatchObject({ kind: 'composed' })
    if (shard.quorum.kind === 'composed') {
      expect([...shard.quorum.operators].sort()).toStrictEqual(['op-a', 'op-b'])
    }
    expect(shard.degraded).toBe(false)
    expect(shard.attestation).toMatchObject({ strength: 'independent' })
  })

  it('degrades by default when one operator holds every candidate, and carries the composer’s reason', async () => {
    const one = enrol('bob-1', 'op-bob', ['relay-1'])
    const two = enrol('bob-2', 'op-bob', ['relay-2'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(one), signing(two)],
        nodes: [descriptorFor(one), descriptorFor(two)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    // The job runs. Phase 12 retired failing a job for a redundancy it could not get,
    // and a candidate set too concentrated to verify is that condition one step out.
    expect(shard.verification.status).toBe('agreed')
    expect(shard.degraded).toBe(true)
    // Not `independent`, which is what makes degrading defensible: the weaker outcome
    // is named by construction.
    expect(shard.attestation).toMatchObject({ strength: 'owner-domain', replicas: 2 })
    expect(shard.quorum).toMatchObject({ kind: 'not-composed', refusal: { kind: 'insufficient-operators' } })
    if (shard.quorum.kind === 'not-composed') {
      // The composer's own words, not a reason this module composed. Without them a
      // caller cannot tell an over-concentrated fabric from any other degradation.
      expect(shard.quorum.reason).toBe(
        'quorum of 2 needs 2 distinct operators, found 1',
      )
    }
  })

  it('refuses the same shard on the same fabric when the caller asked for refusal', async () => {
    const one = enrol('bob-1', 'op-bob', ['relay-1'])
    const two = enrol('bob-2', 'op-bob', ['relay-2'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(one), signing(two)],
        nodes: [descriptorFor(one), descriptorFor(two)],
        redundancy: 2,
        onQuorumShortfall: 'refuses-the-shard',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('insufficient')
    if (shard.verification.status === 'insufficient') {
      expect(shard.verification.reason).toBe('quorum of 2 needs 2 distinct operators, found 1')
    }
    expect(shard.attestation).toMatchObject({ kind: 'holds-no-verified-attestation' })
    expect(r.job.complete).toBe(false)
  })

  it('degrades when every member depends on one relay, and names the relay', async () => {
    const a = enrol('a', 'op-a', ['relay-shared'])
    const b = enrol('b', 'op-b', ['relay-shared'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signing(b)],
        nodes: [descriptorFor(a), descriptorFor(b)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    expect(shard.degraded).toBe(true)
    expect(shard.quorum).toMatchObject({
      kind: 'not-composed',
      refusal: { kind: 'shared-relay-dependency', relayId: 'relay-shared' },
    })
    if (shard.quorum.kind === 'not-composed') {
      expect(shard.quorum.reason).toContain('relay-shared')
    }
    // The receipt reports what the run established — two operators did agree — and the
    // shared dependency is visible on it too rather than inferred from the refusal.
    expect(shard.attestation).toMatchObject({ strength: 'independent', sharedRelay: 'relay-shared' })
  })

  it('refuses when the relay every other candidate depends on is itself a candidate', async () => {
    // VER-03's sharpest case, and the one this path was blind to until 2026-08-14.
    //
    // **This case lives here and not only in `quorum.test.ts` because the mapping that
    // makes it visible exists only here.** `NodeCertificate` names relays by peer id and
    // names its own subject by `nodeKey`; `NodeDescriptor` is the one structure holding
    // both at once, so `submitJob` is the only place that can hand `composeQuorum` a
    // `peerIdOf`. A unit case over certificates alone can assert the rule; only this one
    // can assert that the rule is *reachable* from a submission.
    //
    // The two submissions below differ in exactly one field: the seed's `nodeId`. Same
    // three operators, same three certificates' shape, same relay dependency named by the
    // same two peers, same redundancy, same dial. So a difference in the verdict can only
    // have come from whether the seed is the relay the other two depend on.
    const relayIsCandidate = async (seedNodeId: string): Promise<ShardResult> => {
      const seed = enrolSeed(seedNodeId, 'op-relay')
      const a = enrol('a', 'op-a', ['relay-shared'])
      const b = enrol('b', 'op-b', ['relay-shared'])
      const r = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [{ value: { n: 1 }, label: 'public' }],
          executors: [signing(seed), signing(a), signing(b)],
          nodes: [descriptorFor(seed), descriptorFor(a), descriptorFor(b)],
          redundancy: 2,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        new MemoryBlockstore(),
        // CHURN-03 — this test asserts nothing about checkpointing.
        { checkpoints: 'checkpoints-nothing' },
      )
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error(`fixture job failed: ${JSON.stringify(r.error)}`)
      return r.job.shards[0] as ShardResult
    }

    // ---- The control, read FIRST so the refusal below is a comparison. --------------
    // A seed nobody named. Losing it costs the quorum one member and leaves the other
    // standing, so there is no single dependency and the quorum composes — which is also
    // the pre-existing behaviour of the three seed cases in `quorum.test.ts`, unchanged.
    const unnamed = await relayIsCandidate('some-other-node')
    expect(unnamed.quorum.kind).toBe('composed')
    expect(unnamed.degraded).toBe(false)

    // ---- The case: the seed's peer id IS the relay the other two name. --------------
    const isTheRelay = await relayIsCandidate('relay-shared')
    expect(isTheRelay.quorum).toMatchObject({
      kind: 'not-composed',
      refusal: { kind: 'shared-relay-dependency', relayId: 'relay-shared' },
    })
    if (isTheRelay.quorum.kind !== 'not-composed') return
    // The words say which shape of the refusal this is. A relay that is a member is not
    // a relay every member is discoverable *through* — the pre-existing sentence would
    // be false about this case, and a reason that is false about its own case is worse
    // than none.
    expect(isTheRelay.quorum.reason).toContain('is itself a member of the quorum')
    // It still ran, at the redundancy available, and said so. Degrading is defensible
    // only because it is not silent — the same argument the one-operator case makes.
    expect(isTheRelay.verification.status).toBe('agreed')
    expect(isTheRelay.degraded).toBe(true)
  })

  it('attempts no quorum at redundancy 1, because there is no verification to compose one for', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a)],
        nodes: [descriptorFor(a)],
        redundancy: 1,
        onQuorumShortfall: 'refuses-the-shard',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    // The strict arm is deliberate: a dial consulted where nothing was attempted would
    // refuse a shard that had no shortfall.
    expect(shard.verification.status).toBe('agreed')
    expect(shard.quorum).toMatchObject({ kind: 'not-attempted' })
    if (shard.quorum.kind === 'not-attempted') expect(shard.quorum.reason).toContain('redundancy 1')
    expect(shard.attestation).toMatchObject({ strength: 'owner-attested' })
  })

  it('attempts no quorum for a sovereign shard, which is why owner-domain is reachable at all', async () => {
    // One owner, two of her own nodes. `composeQuorum` holds one certificate per
    // operator by construction, so handing it this shard would refuse it with
    // `insufficient-operators` — correctly, and uselessly, because one operator is the
    // whole point of a sovereign shard. The strict arm is what makes this case bite: if
    // the shard reached the composer it would come back refused rather than agreed.
    const one = enrol('carol-1', 'op-carol', ['relay-1'])
    const two = enrol('carol-2', 'op-carol', ['relay-2'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'sovereign', ownerId: 'carol' }],
        executors: [signing(one), signing(two)],
        nodes: [descriptorFor(one, 'carol'), descriptorFor(two, 'carol')],
        redundancy: 2,
        onQuorumShortfall: 'refuses-the-shard',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    expect(shard.quorum).toMatchObject({ kind: 'not-attempted' })
    if (shard.quorum.kind === 'not-attempted') expect(shard.quorum.reason).toContain('sovereign')
    expect(shard.attestation).toMatchObject({ strength: 'owner-domain', replicas: 2 })
    expect(shard.degraded).toBe(false)
  })

  it('attempts no quorum when a candidate carries no certificate, and the job still runs', async () => {
    // A requestor holding no certificates cannot compose anything, and refusing its job
    // would break every caller that builds descriptors through `publicNodes`. It is not
    // a silent degradation: the receipt says the named absence on every shard.
    const a = enrol('a', 'op-a', ['relay-a'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), honest('bare')],
        nodes: [
          descriptorFor(a),
          { nodeId: 'bare', ownerId: 'public', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
        ],
        redundancy: 2,
        onQuorumShortfall: 'refuses-the-shard',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    expect(shard.quorum).toMatchObject({ kind: 'not-attempted' })
    if (shard.quorum.kind === 'not-attempted') expect(shard.quorum.reason).toContain('certificate')
    expect(shard.attestation).toMatchObject({ kind: 'holds-no-verified-attestation' })
  })

  it('does not pre-declare a strength: a composed quorum whose second member cannot be checked reads the absence', async () => {
    const a = enrol('a', 'op-a', ['relay-a'])
    const b = enrol('b', 'op-b', ['relay-b'])
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 1 }, label: 'public' }],
        executors: [signing(a), signingSomethingElse(b)],
        nodes: [descriptorFor(a), descriptorFor(b)],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    // The gate says who was ASKED; the receipt says who ANSWERED and signed. Taking the
    // strength from `QuorumResult.strength` would report `independent` here.
    expect(shard.quorum).toMatchObject({ kind: 'composed' })
    expect(shard.attestation).toMatchObject({ kind: 'holds-no-verified-attestation', verified: 1 })
  })
})

/**
 * CHURN-05 — the aggregate carries its denominator.
 *
 * ## What every case here CANNOT redden on
 *
 * **None of them can redden on `coverageOf`'s own set arithmetic.** Who is missing, who is
 * unexpected, and whether an empty expected set counts as complete are all decided inside
 * `coverage.ts` and are asserted directly in `coverage.test.ts`. What this file proves is
 * the **composition**: which owners `submitJob` decides were expected, which it decides
 * delivered, and what it hands a caller for a job that has no owners at all. Every one of
 * these cases would stay green against a `coverageOf` that had been rewritten to be wrong
 * in a way that still respected its signature, and that is `coverage.test.ts`'s job.
 *
 * None of them can redden on timing either: coverage is arithmetic over shards already
 * settled, so these cases need no clock, no `sleep` and no held executor.
 *
 * ## The shape a caller has to write, written once here
 *
 * {@link renderCoverage} is what a display site looks like — the named arm handled first,
 * `describeCoverage` reachable only past it. It is not a convenience for the assertions:
 * it is the thing under test in the public-job case, because a union that is present and
 * then rendered through the partial branch anyway is the defect wearing the fix's clothes.
 */
describe('CHURN-05 — the one job path reports how many of its owners contributed', () => {
  /** A node of `owner`, able to run their sovereign work, idle. */
  function ownedBy(nodeId: string, ownerId: string): NodeDescriptor {
    return { nodeId, ownerId, canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' }
  }

  /** The report, or a failure that says the job took the *named* arm instead. */
  function reportOf(coverage: JobResult['coverage']): CoverageReport {
    if (coverage === 'defines-no-owners') {
      throw new Error('this job reported `defines-no-owners`, so there is no report to read')
    }
    return coverage
  }

  /** What a job with no owners says, in the caller's words rather than the report's. */
  const NO_OWNERS = 'this job defines no owners'

  /**
   * Every display site's shape: handle the named arm, and only then describe a report.
   *
   * A caller that cannot reach `describeCoverage` without having answered "does this job
   * define owners at all?" is the whole reason the field is a union.
   */
  function renderCoverage(coverage: JobResult['coverage']): string {
    return coverage === 'defines-no-owners' ? NO_OWNERS : describeCoverage(coverage)
  }

  /**
   * A node that takes the work and says nothing until `release()`.
   *
   * A deferred promise rather than a delay, so "slow" is a fact this fixture states
   * rather than one it hopes for. **A deliberate local copy of the CHURN-02 block's
   * `holding`**, whose helpers are private to that block; hoisting them to module scope
   * would be a larger edit to another plan's work than the one case below is worth, and
   * this copy answers `honest`'s own bytes so the two cannot describe different jobs.
   */
  function held(nodeId: string): { readonly executor: Executor; readonly release: () => void } {
    let answer: ((outcome: ExecutionOutcome) => void) | null = null
    let handed: Task | null = null
    const work = new Promise<ExecutionOutcome>((resolve) => {
      answer = resolve
    })
    return {
      executor: {
        nodeId,
        execute(shardTask: Task): Promise<ExecutionOutcome> {
          handed = shardTask
          return work
        },
      },
      release: (): void => {
        if (answer === null || handed === null) return
        // Synchronously, and with a literal outcome rather than by awaiting `honest`:
        // whichever copy resolves first wins, and this fixture needs the straggler to.
        answer({
          ok: true,
          output: { shard: handed.partitionIndex, of: handed.partitionCount, sum: handed.partitionIndex * 10 },
          fuelUsed: 100,
          attestation: 'signed-by-nobody',
        })
      },
    }
  }

  /**
   * Virtual time with a horizon, so a loop that never terminates is a named failure
   * rather than a hang no test timeout can reach. Stated as a multiple of
   * `DEFAULT_LEASE_MS` because it is virtual and encodes no machine.
   */
  function virtualClock(horizon: number): JobClock {
    let t = 0
    return {
      now: (): number => t,
      sleep: async (ms: number): Promise<void> => {
        t += ms
        if (t > horizon) {
          throw new Error(`the clock passed ${horizon}ms of virtual time — this job is not bounded`)
        }
        // Drains the microtask queue without measuring wall time — see the CHURN-02
        // block's header for why both halves are needed.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
      },
    }
  }

  /** An executor that answers honestly except on the partitions named, which it refuses. */
  function honestExcept(nodeId: string, refuses: readonly number[]): Executor {
    return {
      nodeId,
      async execute(task: Task): Promise<ExecutionOutcome> {
        return refuses.includes(task.partitionIndex)
          ? { ok: false, reason: `${nodeId} could not read partition ${task.partitionIndex}` }
          : honest(nodeId).execute(task)
      },
    }
  }

  it('names an owner whose nodes are all missing, rather than dropping them from the denominator', async () => {
    // Carol has a shard and no node. She is *expected* because the job defines work for
    // her — a shard is defined for an owner whether or not that owner's fabric is up —
    // which is the whole reason the owner set is derived from the shards and not from
    // whoever happened to answer.
    const executors = [honest('alice-1'), honest('bob-1')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [
          { value: { n: 0 }, label: 'sovereign', ownerId: 'alice' },
          { value: { n: 1 }, label: 'sovereign', ownerId: 'bob' },
          { value: { n: 2 }, label: 'sovereign', ownerId: 'carol' },
        ],
        executors,
        nodes: [ownedBy('alice-1', 'alice'), ownedBy('bob-1', 'bob')],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const report = reportOf(r.job.coverage)
    // ANTI-VACUITY: the owner by NAME, not merely `covered < total`. An arithmetic-only
    // reading is satisfied by a miscount that names the wrong owner, and naming the wrong
    // owner is worse than not naming one — it sends somebody to the wrong node.
    expect(report.missing).toStrictEqual(['carol'])
    expect(report.covered).toBe(2)
    expect(report.total).toBe(3)
    expect(report.complete).toBe(false)
    // Criterion 4's own words, taken from `describeCoverage` rather than transcribed —
    // the discipline `bench-attestation.node.test.ts` applies to `describeAttestation`,
    // which is what stops an assertion pinning a sentence a later edit changes for good
    // reason. A structured field can be right while nothing renders it.
    expect(renderCoverage(r.job.coverage)).toContain('covered: 2/3 owners')
    expect(renderCoverage(r.job.coverage)).toContain('missing carol')
    // Carol's shard is the *unplaceable* arm, so this also says coverage reads a shard
    // that never ran at all, not only one that ran and failed.
    expect((r.job.shards[2] as ShardResult).ending).toBe('never-placed')

    // WHAT THIS CANNOT REDDEN ON. **Not the per-owner gate.** Carol contributed zero of
    // one shard, so she lands in `missing` under the per-owner rule and under the wrong
    // "any one shard counts" rule alike. The case below is the only one that separates
    // them, and this note is here so the pair is not read as one claim twice.
  })

  it('refuses to count an owner who delivered one shard of four — the per-owner gate', async () => {
    // THE case that carries the gate. Alice's first shard agrees and her other three
    // fail, so every "did this owner appear?" rule reports her covered and only "did this
    // owner deliver everything they owe?" does not. `coordinator.ts`'s own words for what
    // the wrong rule costs: `complete` would be true over a quarter of her data.
    const executors = [honestExcept('alice-1', [1, 2, 3]), honest('bob-1')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [
          { value: { n: 0 }, label: 'sovereign', ownerId: 'alice' },
          { value: { n: 1 }, label: 'sovereign', ownerId: 'alice' },
          { value: { n: 2 }, label: 'sovereign', ownerId: 'alice' },
          { value: { n: 3 }, label: 'sovereign', ownerId: 'alice' },
          { value: { n: 4 }, label: 'sovereign', ownerId: 'bob' },
        ],
        executors,
        nodes: [ownedBy('alice-1', 'alice'), ownedBy('bob-1', 'bob')],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // ANTI-VACUITY, and it is the whole case: one of alice's shards DID agree. Without
    // this reading "alice is missing" would also be satisfied by a job in which she
    // delivered nothing, which is the case above.
    expect((r.job.shards[0] as ShardResult).verification.status).toBe('agreed')
    expect((r.job.shards[1] as ShardResult).verification.status).toBe('insufficient')
    const report = reportOf(r.job.coverage)
    expect(report.missing).toStrictEqual(['alice'])
    expect(report.covered).toBe(1)
    expect(report.total).toBe(2)
    expect(renderCoverage(r.job.coverage)).toContain('covered: 1/2 owners')

    // WHAT THIS CANNOT REDDEN ON. Not the named union — this job has owners, so the
    // sentinel arm is never taken. Not the derivation source either: every node in the
    // fixture owns a shard, so a coverage computed over the *nodes* would give the same
    // two owners. The last case below is the one that separates those.
  })

  it('says by name that a public job defines no owners, and never renders it as a partial anything', async () => {
    // Every benchmark rung in this repository is this job. A bare `CoverageReport` here
    // reads `covered: 0/0 owners — PARTIAL (no owners were expected)`, because
    // `coverageOf` refuses to call an empty owner set complete — correctly, for a
    // question this job was never entered for.
    const executors = [honest('n1'), honest('n2')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [
          { value: { n: 0 }, label: 'public' },
          { value: { n: 1 }, label: 'public' },
        ],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The named arm itself.
    expect(r.job.coverage).toBe('defines-no-owners')
    // ANTI-VACUITY: and `describeCoverage` is never reached for it. A union that is
    // present but rendered through the partial branch anyway is the defect wearing the
    // fix's clothes, and `PARTIAL` is the word that would appear if it were.
    const rendered = renderCoverage(r.job.coverage)
    expect(rendered).toBe(NO_OWNERS)
    expect(rendered).not.toContain('PARTIAL')
    expect(rendered).not.toContain('covered:')
    // The job itself went perfectly well, so nothing else in the result explains an
    // apology if one appeared.
    expect(r.job.complete).toBe(true)

    // WHAT THIS CANNOT REDDEN ON. Nothing about the per-owner gate: there are no owners
    // to gate. It also cannot tell a job that took the named arm because it has no
    // sovereign shard from one that took it for some other reason — the first case's
    // three-owner job is what says the arm is not taken unconditionally.
  })

  it('reports full coverage on a job that is NOT complete, because a public shard disagreed', async () => {
    // Coverage and completeness are different questions with different remedies, and the
    // pair of readings is what proves it. Alice delivered everything she owes; a public
    // shard — which belongs to no owner and therefore touches no coverage — disagreed.
    // A caller told only "incomplete" would go looking for a missing owner and find none.
    //
    // Node ids are chosen so `planPlacement`'s least-loaded-then-by-id ordering puts the
    // public shard on `p1`/`p2`: every node is at load 0, the public shard is partition 0
    // so nothing has been nudged yet, and `p*` sorts before `z*`.
    const executors = [honest('p1'), liar('p2'), honest('z1'), honest('z2')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [
          { value: { n: 0 }, label: 'public' },
          { value: { n: 1 }, label: 'sovereign', ownerId: 'alice' },
        ],
        executors,
        nodes: [
          ownedBy('p1', 'public'),
          ownedBy('p2', 'public'),
          ownedBy('z1', 'alice'),
          ownedBy('z2', 'alice'),
        ],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const publicShard = r.job.shards[0] as ShardResult
    const alices = r.job.shards[1] as ShardResult
    expect(publicShard.verification.status).toBe('disagreed')
    expect(alices.verification.status).toBe('agreed')
    expect(alices.degraded).toBe(false)
    // Fully covered — alice owed one shard and delivered it.
    const report = reportOf(r.job.coverage)
    expect(report.complete).toBe(true)
    expect(report.covered).toBe(1)
    expect(report.total).toBe(1)
    expect(renderCoverage(r.job.coverage)).toContain('covered: 1/1 owners')
    // And not complete, on the other axis entirely.
    expect(r.job.complete).toBe(false)

    // WHAT THIS CANNOT REDDEN ON, and it is the half of independence that IS reachable.
    // The other direction — complete but not fully covered — **cannot be constructed on
    // this path at all**, and the reason is the plan's own decision not to add a
    // `JobSpec` owner field: an owner is expected only by having a shard, and that shard
    // sits inside `complete`'s conjunction, so `complete` implies fully covered. A
    // *declared* owner set (`runResilient`'s optional `expectedOwners`) is what would make
    // it reachable, and declaring one is exactly what was refused. Recorded here rather
    // than faked with a fixture that pretends otherwise.
  })

  it('counts an owner whose shard agreed at REDUCED redundancy — the degraded decision, stated', async () => {
    // The `degraded` axis, decided in writing and asserted here so a later change reddens
    // rather than drifts. Alice's shard agreed at one replica of the two it asked for.
    // She still contributed: her data was read and reduced. What is weaker is the
    // *verification*, which `degraded` and `complete` already report, and folding it into
    // coverage would make `1/1` versus `0/1` answer two questions at once.
    const executors = [
      honest('z1'),
      failing('z2', 'alice’s second node dropped the dispatch'),
      honest('b1'),
    ]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 0 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [ownedBy('z1', 'alice'), ownedBy('z2', 'alice'), ownedBy('b1', 'bob')],
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const shard = r.job.shards[0] as ShardResult
    expect(shard.verification.status).toBe('agreed')
    if (shard.verification.status === 'agreed') expect(shard.verification.replicas).toBe(1)
    expect(shard.degraded).toBe(true)
    // Alice's own two nodes and nobody else's — the top-up had nowhere legal to go, which
    // is what makes this shard degraded rather than repaired.
    expect(shard.attempted).toStrictEqual(['z1', 'z2'])
    expect(shard.ending).toBe('no-untried-node')
    // THE DECISION: degraded does not disqualify. Change the answer and this line is where
    // it has to be changed, in the open.
    const report = reportOf(r.job.coverage)
    expect(report.complete).toBe(true)
    expect(report.covered).toBe(1)
    expect(report.missing).toStrictEqual([])
    // The second half of the independence pair, by a different mechanism from the case
    // above: fully covered, and still not complete.
    expect(r.job.complete).toBe(false)

    // WHAT THIS CANNOT REDDEN ON. Not the per-owner gate — alice owes one shard and
    // delivered one. Not the named union. It is the only case here that would move if
    // `landedForItsOwner` grew a `!degraded` clause, which is precisely why it exists.
  })

  it('derives the owner set from the job’s own shards, never from the owners of its nodes', async () => {
    // Bob's nodes are in the pool and bob has no shard. He is not missing from anything:
    // this job never asked for his data. A coverage computed over `spec.nodes` — the
    // implementation this reading exists to refuse — would report `1/2` and send somebody
    // to find a node that was there all along.
    const executors = [honest('z1'), honest('b1'), honest('b2')]
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: [{ value: { n: 0 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [ownedBy('z1', 'alice'), ownedBy('b1', 'bob'), ownedBy('b2', 'bob')],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const report = reportOf(r.job.coverage)
    expect(report.total).toBe(1)
    expect(report.covered).toBe(1)
    expect(report.missing).toStrictEqual([])
    expect(renderCoverage(r.job.coverage)).toContain('covered: 1/1 owners')

    // WHAT THIS CANNOT REDDEN ON — and one reading deliberately NOT taken. `unexpected`
    // is not asserted here, because on this path it cannot be anything but empty: the
    // expected set and the delivered set are both derived from `spec.shards[i].ownerId`
    // through one map, so the second is a subset of the first by construction. Asserting
    // `[]` would be transcribing that construction, not measuring it. What would make the
    // field reachable is a delivered owner read from a *second* source — a `ShardResult`
    // carrying its own owner, or an egress manifest — and until there is one, `unexpected`
    // is kept as the tripwire for that day rather than removed as dead.
  })

  it('does not count a shard whose losing copy answered DIFFERENTLY, however well it agreed', async () => {
    // **Beyond the plan's six, and here because this executor added the clause it
    // carries.** `landedForItsOwner` requires `agreed` AND no late disagreement; the
    // second half post-dates the sentence in `verify.ts` the first half transcribes, and
    // a clause with no reading is a clause nobody is holding. Speculation is the only
    // producer of a late disagreement, so this is the only shape that can reach it: ten
    // sovereign shards (the default fraction's allowance is `floor(shards × 0.1)`, so
    // fewer than ten cannot speculate at all), nine finishing at once so the median has
    // more than `MIN_SAMPLES` behind it, and the tenth held until its duplicate — which
    // lies — has been dispatched.
    const alices = Array.from({ length: 11 }, (_, i) => `a${String(i).padStart(2, '0')}`)
    const straggler = held(alices[0] as string)
    const executors: readonly Executor[] = alices.map((nodeId, i) => {
      if (i === 0) return straggler.executor
      if (i !== 1) return honest(nodeId)
      return {
        nodeId,
        async execute(shardTask: Task): Promise<ExecutionOutcome> {
          // The duplicate of partition 0 lands here. Releasing the straggler first is
          // what makes IT the winner and this copy the loser, which is the arrangement
          // under test: a shard that agreed, with a copy that disagreed.
          if (shardTask.partitionIndex !== 0) return honest(nodeId).execute(shardTask)
          straggler.release()
          return liar(nodeId).execute(shardTask)
        },
      }
    })
    const r = await submitJob(
      {
        moduleCid: MODULE_CID,
        shards: Array.from(
          { length: 10 },
          (_, i): ShardSpec => ({ value: { n: i }, label: 'sovereign', ownerId: 'alice' }),
        ),
        executors,
        nodes: alices.map((nodeId) => ownedBy(nodeId, 'alice')),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      new MemoryBlockstore(),
      { checkpoints: 'checkpoints-nothing', clock: virtualClock(DEFAULT_LEASE_MS * 10) },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slow = r.job.shards[0] as ShardResult
    // ANTI-VACUITY, and it is the whole case: the shard AGREED. A rule reading
    // `verification.status` alone counts it, and alice then reads 10 of 10.
    expect(slow.verification.status).toBe('agreed')
    expect(slow.speculated).toBe(true)
    expect(slow.disagreed).toBe(true)
    expect(r.job.shards.slice(1).every((shard) => shard.verification.status === 'agreed')).toBe(true)
    // Nine of alice's ten landed, so she did not contribute — the per-owner gate and the
    // late-disagreement clause reaching the same answer through different halves.
    const report = reportOf(r.job.coverage)
    expect(report.covered).toBe(0)
    expect(report.total).toBe(1)
    expect(report.missing).toStrictEqual(['alice'])
    expect(renderCoverage(r.job.coverage)).toContain('covered: 0/1 owners')

    // WHAT THIS CANNOT REDDEN ON. Not the comparison machinery itself — that a losing
    // copy is read at all, and that its CID is compared the right way round, is 20-07's
    // claim and `reports a losing copy that answers DIFFERENTLY…` carries it. What is
    // asserted here is only that coverage consults the answer that comparison produced.
    // It also cannot separate the two halves of `landedForItsOwner`: alice fails the
    // per-owner gate at 9 of 10 as well, so this case says the clause is *consulted*, and
    // the partial-owner case above is what says the gate is per-owner.
  })
})

/**
 * CHURN-03 — the job survives its requestor.
 *
 * ## What every case here CANNOT redden on
 *
 * - **`checkpoint.ts`'s own arithmetic.** Whether `checkpointOf` sorts and dedupes,
 *   whether `readCheckpoint` validates each field, what `remainingWork` returns for a
 *   given `completed` set, and whether `recoverCheckpoint` counts skips correctly are all
 *   decided in that module and asserted directly in `checkpoint.test.ts`. What this block
 *   proves is the **composition**: when `submitJob` writes, what it writes, which shards a
 *   resume declines to run, and what a resume refuses.
 * - **A requestor process that actually goes away.** Every case here runs in one process
 *   and models departure by *not carrying anything forward except a CID*. The real
 *   departure — a spawned fabric, a requestor closed, a second requestor stood up against
 *   the same live agents — is `packages/node/src/checkpoint-agents.node.test.ts`, and the
 *   once-in-total dispatch count is that file's reading, not this one's.
 * - **A lost checkpoint block reappearing.** {@link losing} hides a block from a reader;
 *   it does not delete it, because `Blockstore` has no `delete` and inventing one for a
 *   test would be a production change made for a fixture. `churn.test.ts` used a second
 *   store for the same purpose; a wrapper says which block is lost, which is sharper.
 *
 * ## The clock is frozen, and that is what makes a byte comparison possible
 *
 * {@link frozenClock} reports the same instant forever, so every checkpoint this block
 * writes carries `at: 0` and two jobs' blocks are comparable byte for byte. Its `sleep`
 * resolves on a macrotask, so a settled dispatch always wins the lease race and no case
 * here depends on how many turns an executor took. Nothing below asserts a duration.
 */
describe('CHURN-03 — a departed requestor leaves a record, and a second one finishes from it', () => {
  /**
   * A clock that does not move, with a bound on how many times it may be asked to wait.
   *
   * `now` is constant so the `at` field of every checkpoint is the same number, which is
   * what lets the size reading below be a byte comparison rather than an approximation.
   * `sleep` resolves on a `setTimeout(0)` — a macrotask — so a dispatch that has already
   * answered wins its race against the lease deadline every time, and the bound turns a
   * loop that never terminates into a named failure rather than a hang.
   */
  function frozenClock(waits: number): JobClock {
    let slept = 0
    return {
      now: (): number => 0,
      sleep: async (): Promise<void> => {
        slept += 1
        if (slept > waits) throw new Error(`this job asked to wait more than ${waits} times`)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
      },
    }
  }

  /** Every handle this job published, in the order it published them. */
  function recorder(): { readonly sink: CheckpointSink; readonly handles: CID[]; readonly written: JobCheckpoint[] } {
    const handles: CID[] = []
    const written: JobCheckpoint[] = []
    return {
      handles,
      written,
      sink: {
        publish: async (handle: CID, checkpoint: JobCheckpoint): Promise<void> => {
          handles.push(handle)
          written.push(checkpoint)
        },
      },
    }
  }

  /** An honest executor that records which partitions it was actually handed. */
  function counting(nodeId: string, seen: number[]): Executor {
    return {
      nodeId,
      async execute(shardTask: Task): Promise<ExecutionOutcome> {
        seen.push(shardTask.partitionIndex)
        return honest(nodeId).execute(shardTask)
      },
    }
  }

  /** An honest executor whose output is `width` bytes of padding — the size axis. */
  function bulky(nodeId: string, width: number): Executor {
    return {
      nodeId,
      async execute(shardTask: Task): Promise<ExecutionOutcome> {
        return {
          ok: true,
          output: { shard: shardTask.partitionIndex, pad: 'x'.repeat(width) },
          fuelUsed: 100,
          attestation: 'signed-by-nobody',
        }
      },
    }
  }

  /** An honest executor that refuses the partitions named — used to leave work outstanding. */
  function refusing(nodeId: string, refuses: readonly number[]): Executor {
    return {
      nodeId,
      async execute(shardTask: Task): Promise<ExecutionOutcome> {
        return refuses.includes(shardTask.partitionIndex)
          ? { ok: false, reason: `${nodeId} will not run partition ${shardTask.partitionIndex}` }
          : honest(nodeId).execute(shardTask)
      },
    }
  }

  /**
   * The same store with one block unreadable — a lost block, stated rather than deleted.
   *
   * `has` lies in step with `get`, because a store that admitted holding a block it would
   * not hand over would be a third condition nothing in production produces.
   */
  function losing(inner: Blockstore, lost: CID): Blockstore {
    const hidden = lost.toString()
    return {
      put: (bytes) => inner.put(bytes),
      get: async (cid) => (cid.toString() === hidden ? undefined : inner.get(cid)),
      has: async (cid) => (cid.toString() === hidden ? false : inner.has(cid)),
      get size(): number {
        return inner.size
      },
    }
  }

  const SHARDS = 8
  const OUTSTANDING = [4, 5, 6, 7]

  /** The job every case in this block submits, minus whoever is going to run it. */
  function specOver(executors: readonly Executor[]): JobSpec {
    return {
      moduleCid: MODULE_CID,
      shards: Array.from({ length: SHARDS }, (_, i) => ({
        value: { churn: 'checkpoint', partition: i } as CanonicalValue,
        label: 'public' as const,
      })),
      executors,
      nodes: publicNodes(executors),
      redundancy: 1,
      onQuorumShortfall: 'runs-at-available-redundancy',
    }
  }

  /** Every shard's agreed result CID in shard order, `null` where it did not agree. */
  function cidsOf(job: JobResult): readonly (string | null)[] {
    return job.shards.map((shard) =>
      shard.verification.status === 'agreed' ? shard.verification.resultCid.toString() : null,
    )
  }

  it('writes one checkpoint per shard that answers, and none at all for a caller that named no sink', async () => {
    // THE CADENCE, read as a difference between two stores in one run rather than as an
    // absolute block count — which would encode this fixture's shard count and its
    // module. The two jobs are identical apart from the option, so every block either
    // store holds beyond the other is a checkpoint.
    const quiet = new MemoryBlockstore()
    const noSink = await submitJob(specOver([honest('a'), honest('b')]), quiet, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
    })
    expect(noSink.ok).toBe(true)
    if (!noSink.ok) return
    expect(noSink.job.complete).toBe(true)

    const loud = new MemoryBlockstore()
    const log = recorder()
    const withSink = await submitJob(specOver([honest('a'), honest('b')]), loud, {
      clock: frozenClock(64),
      checkpoints: log.sink,
    })
    expect(withSink.ok).toBe(true)
    if (!withSink.ok) return
    expect(withSink.job.complete).toBe(true)

    // One handle per shard that answered — the stated cadence, in the caller's hands.
    expect(log.handles).toHaveLength(SHARDS)
    // And one block per handle in the store, over and above everything the quiet job
    // wrote. Both jobs put the same 8 inputs and the same 8 outputs.
    expect(loud.size - quiet.size).toBe(SHARDS)
    // The handles are distinct, so the count above is 8 writes and not one block rewritten
    // 8 times. `checkpointOf` sorts and dedupes, so equal knowledge gives an equal CID —
    // which means distinct CIDs here say the knowledge grew each time.
    expect(new Set(log.handles.map((cid) => cid.toString())).size).toBe(SHARDS)
    // Each names one more shard than the last, and the last names them all.
    expect(log.written.map((checkpoint) => checkpoint.completed.length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect((log.written[SHARDS - 1] as JobCheckpoint).completed.map((s) => s.partitionIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    // A line, not a fork: each checkpoint names its predecessor's handle, and the first
    // names nothing. This is what `checkpointChain` walks, and a concurrent job that wrote
    // without serialising would produce two checkpoints claiming the same `previous`.
    expect((log.written[0] as JobCheckpoint).previous).toBeNull()
    for (let i = 1; i < SHARDS; i++) {
      expect((log.written[i] as JobCheckpoint).previous).toBe((log.handles[i - 1] as CID).toString())
    }

    // WHAT THIS CANNOT REDDEN ON: that the blocks are *checkpoints*. The size difference
    // would be satisfied by 8 blocks of anything. The cases below read them back.
  })

  it('names results rather than carrying them — the block is the same size whatever the answers weigh', async () => {
    // THE "NAMES, DOES NOT CARRY" READING, and it is comparative on purpose: an absolute
    // byte bound would encode this fixture's shard count, its module CID and its codec.
    // Two jobs over the SAME inputs — so the same job id — differing only in how much each
    // shard's answer weighs.
    const small = new MemoryBlockstore()
    const smallLog = recorder()
    const thin = await submitJob(specOver([bulky('a', 8), bulky('b', 8)]), small, {
      clock: frozenClock(64),
      checkpoints: smallLog.sink,
    })
    const large = new MemoryBlockstore()
    const largeLog = recorder()
    const fat = await submitJob(specOver([bulky('a', 8_000), bulky('b', 8_000)]), large, {
      clock: frozenClock(64),
      checkpoints: largeLog.sink,
    })

    expect(thin.ok).toBe(true)
    expect(fat.ok).toBe(true)
    if (!thin.ok || !fat.ok) return
    expect(thin.job.complete).toBe(true)
    expect(fat.job.complete).toBe(true)

    // ANTI-VACUITY, taken first: the answers really do differ by an order of magnitude.
    // Without this the equality below is satisfied by two jobs whose outputs were the same
    // size, which is the shape this reading exists to rule out.
    const weigh = async (job: JobResult, store: MemoryBlockstore): Promise<number> => {
      let bytes = 0
      for (const shard of job.shards) {
        if (shard.verification.status !== 'agreed') continue
        bytes += (await store.get(shard.verification.resultCid))?.length ?? 0
      }
      return bytes
    }
    const thinBytes = await weigh(thin.job, small)
    const fatBytes = await weigh(fat.job, large)
    expect(fatBytes).toBeGreaterThan(thinBytes * 10)

    // And the record of them is byte-for-byte the same size. Both jobs ran over the same
    // ordered inputs, so their job ids are equal-length CIDs; every result CID is a CID;
    // the clock is frozen so `at` is the same number in both. Nothing left that could
    // differ except the answers, and the answers are not in there.
    const lastOf = async (log: ReturnType<typeof recorder>, store: MemoryBlockstore): Promise<number> => {
      const handle = log.handles[log.handles.length - 1] as CID
      return ((await store.get(handle)) as Uint8Array).length
    }
    expect(await lastOf(largeLog, large)).toBe(await lastOf(smallLog, small))

    // WHAT THIS CANNOT REDDEN ON: a checkpoint that carried a *fixed-size* summary of the
    // output — a length, say — would also pass. What it rules out is the answer itself
    // being in there, which is the property a resume's cost depends on.
  })

  it('resumes from a CID and dispatches ONLY the shards the checkpoint does not name', async () => {
    // THE LOAD-BEARING CASE. The first requestor answers half the job and refuses the
    // rest, so its newest handle names exactly {0,1,2,3} — deterministic, rather than
    // "whatever had settled when we looked".
    const store = new MemoryBlockstore()
    const log = recorder()
    const departed = await submitJob(
      specOver([refusing('a', OUTSTANDING), refusing('b', OUTSTANDING), refusing('c', OUTSTANDING)]),
      store,
      { clock: frozenClock(256), checkpoints: log.sink },
    )
    expect(departed.ok).toBe(true)
    if (!departed.ok) return
    // The departure it stands in for: half the job answered, half outstanding.
    expect(departed.job.complete).toBe(false)
    expect(cidsOf(departed.job).filter((cid) => cid !== null)).toHaveLength(4)
    const handle = log.handles[log.handles.length - 1] as CID
    expect((log.written[log.written.length - 1] as JobCheckpoint).completed.map((s) => s.partitionIndex)).toEqual([
      0, 1, 2, 3,
    ])

    // The second requestor. It is handed the job spec and ONE CID, and it counts what it
    // was actually asked to run.
    const seen: number[] = []
    const resumed = await submitJob(specOver([counting('d', seen), counting('e', seen)]), store, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
      resumeFrom: [handle],
    })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return

    // (1) THE DISPATCH COUNT — asserted instead of the answer, because the answer is
    // identical whether or not the resume skipped anything. That is the whole reason this
    // reading exists and it is why a case asserting only the CIDs would be green against a
    // resume that re-ran the entire job.
    expect([...new Set(seen)].sort((x, y) => x - y)).toEqual(OUTSTANDING)
    expect(seen).toHaveLength(OUTSTANDING.length)

    // (2) The carried shards say so BY NAME. `generations: 0` and an empty `attempted`
    // read exactly the same on a shard nobody would take, so the ending is what
    // distinguishes "somebody already did this" from "nobody would".
    for (let i = 0; i < 4; i++) {
      const shard = resumed.job.shards[i] as ShardResult
      expect(shard.ending).toBe('carried-from-checkpoint')
      expect(shard.attempted).toEqual([])
      expect(shard.generations).toBe(0)
      expect(shard.verification.status).toBe('agreed')
    }
    for (const i of OUTSTANDING) {
      const shard = resumed.job.shards[i] as ShardResult
      expect(shard.ending).toBe('agreed')
      expect(shard.attempted).toHaveLength(1)
    }

    // (3) The answer is the departed requestor's answer, per shard by CID — a lookup, not
    // a recomputation. And the four it ran are answers nobody had before.
    expect(cidsOf(resumed.job).slice(0, 4)).toEqual(cidsOf(departed.job).slice(0, 4))
    expect(cidsOf(resumed.job).filter((cid) => cid === null)).toEqual([])

    // (4) A resumed job is NOT `complete`, and that is the truthful reading rather than a
    // defect: this requestor obtained zero replicas of the four it carried, so it cannot
    // claim the redundancy the job asked for on them. Saying otherwise would assert a
    // verification nobody in this process performed.
    expect(resumed.job.complete).toBe(false)
    for (let i = 0; i < 4; i++) expect((resumed.job.shards[i] as ShardResult).degraded).toBe(true)
    for (const i of OUTSTANDING) expect((resumed.job.shards[i] as ShardResult).degraded).toBe(false)
  })

  it('produces the same per-shard answer a single uninterrupted run produces over the same inputs', async () => {
    // The control, in the same fixture rather than a pinned literal: the identical job,
    // over the identical inputs, run by one requestor that never went away.
    const control = await submitJob(specOver([honest('a'), honest('b')]), new MemoryBlockstore(), {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
    })
    expect(control.ok).toBe(true)
    if (!control.ok) return
    expect(control.job.complete).toBe(true)

    const store = new MemoryBlockstore()
    const log = recorder()
    const departed = await submitJob(
      specOver([refusing('a', OUTSTANDING), refusing('b', OUTSTANDING), refusing('c', OUTSTANDING)]),
      store,
      { clock: frozenClock(256), checkpoints: log.sink },
    )
    expect(departed.ok).toBe(true)
    if (!departed.ok) return

    const resumed = await submitJob(specOver([honest('d'), honest('e')]), store, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
      resumeFrom: [log.handles[log.handles.length - 1] as CID],
    })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return

    // Different nodes ran the second half — `d` and `e` never existed for the first
    // requestor — and the bytes are the same, which is the liveness invariant stated as an
    // equality: who computes a task and when changes; what the answer is does not.
    expect(cidsOf(resumed.job)).toEqual(cidsOf(control.job))
    // ANTI-VACUITY: eight distinct answers, so the equality above is eight readings and
    // not one repeated.
    expect(new Set(cidsOf(control.job)).size).toBe(SHARDS)
  })

  it('recovers to an OLDER handle when the newest checkpoint block is lost, at the cost of work and not of correctness', async () => {
    const store = new MemoryBlockstore()
    const log = recorder()
    const departed = await submitJob(
      specOver([refusing('a', OUTSTANDING), refusing('b', OUTSTANDING), refusing('c', OUTSTANDING)]),
      store,
      { clock: frozenClock(256), checkpoints: log.sink },
    )
    expect(departed.ok).toBe(true)
    if (!departed.ok) return
    expect(log.handles).toHaveLength(4)

    const newest = log.handles[3] as CID
    const older = log.handles[2] as CID
    // The newest names one more shard than the one behind it. That difference is the
    // ground this case is about losing.
    expect((log.written[3] as JobCheckpoint).completed).toHaveLength(4)
    expect((log.written[2] as JobCheckpoint).completed).toHaveLength(3)

    // Both handles are still handed over — a coordinator publishes every handle it wrote,
    // which is exactly why `recoverCheckpoint` takes a list. The newest block is gone.
    const seen: number[] = []
    const resumed = await submitJob(
      specOver([counting('d', seen), counting('e', seen)]),
      losing(store, newest),
      { checkpoints: 'checkpoints-nothing', clock: frozenClock(64), resumeFrom: [newest, older] },
    )
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return

    // FIVE, not four: the older view is an older *complete* view, so the shard the lost
    // checkpoint would have let this requestor skip is run again. Work, never correctness.
    expect(seen).toHaveLength(5)
    expect(resumed.job.shards.filter((shard) => shard.ending === 'carried-from-checkpoint')).toHaveLength(3)
    // And the answer still lands: every shard agreed, and the three carried ones are the
    // departed requestor's own CIDs.
    expect(cidsOf(resumed.job).filter((cid) => cid === null)).toEqual([])
    const carriedIndices = resumed.job.shards
      .filter((shard) => shard.ending === 'carried-from-checkpoint')
      .map((shard) => shard.partitionIndex)
    for (const i of carriedIndices) {
      expect(cidsOf(resumed.job)[i]).toBe(cidsOf(departed.job)[i])
    }
    // The re-run shard is the one the lost checkpoint named and the older one does not.
    const lostGround = (log.written[3] as JobCheckpoint).completed
      .map((s) => s.partitionIndex)
      .filter((i) => !carriedIndices.includes(i))
    expect(lostGround).toHaveLength(1)
    expect(seen).toContain(lostGround[0])
  })

  it('resumes a FINISHED job by dispatching nothing at all', async () => {
    const store = new MemoryBlockstore()
    const log = recorder()
    const first = await submitJob(specOver([honest('a'), honest('b')]), store, {
      clock: frozenClock(64),
      checkpoints: log.sink,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.job.complete).toBe(true)

    const seen: number[] = []
    const again = recorder()
    const resumed = await submitJob(specOver([counting('d', seen), counting('e', seen)]), store, {
      clock: frozenClock(64),
      resumeFrom: [log.handles[SHARDS - 1] as CID],
      checkpoints: again.sink,
    })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return

    // Nothing ran, and nothing was written — a checkpoint is published when knowledge
    // *grows*, and a resume of a finished job learns nothing.
    expect(seen).toEqual([])
    expect(again.handles).toEqual([])
    expect(resumed.job.shards.every((shard) => shard.ending === 'carried-from-checkpoint')).toBe(true)
    expect(cidsOf(resumed.job)).toEqual(cidsOf(first.job))
    // Nothing was placed either, so no node was so much as asked about a partition that
    // was already answered. This is the reading `submit.ts` takes at the offer arm.
    expect(resumed.job.leaseHistory).toEqual([])
    expect(resumed.job.redispatches).toBe(0)
  })

  it('refuses a resume against a CID that is not a checkpoint, BY NAME rather than by exception', async () => {
    const store = new MemoryBlockstore()
    // A real block of this very job — a shard input — which decodes fine and is not a
    // checkpoint. The sharper fixture than a random CID, because it reaches the field
    // validation rather than stopping at the block lookup.
    const encoded = await canonicalCid({ churn: 'checkpoint', partition: 0 })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    await store.put(encoded.bytes)

    const notACheckpoint = await submitJob(specOver([honest('a')]), store, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
      resumeFrom: [encoded.cid],
    })
    expect(notACheckpoint.ok).toBe(false)
    if (notACheckpoint.ok) return
    expect(notACheckpoint.error.kind).toBe('checkpoint-unreadable')
    if (notACheckpoint.error.kind !== 'checkpoint-unreadable') return
    // The FAILURE KIND and the FIELD, not merely that something went wrong: `malformed`
    // with `jobId` says the block was found and decoded and does not describe a job, which
    // is a different remedy from a block that is simply absent.
    expect(notACheckpoint.error.failure.kind).toBe('malformed')
    if (notACheckpoint.error.failure.kind !== 'malformed') return
    expect(notACheckpoint.error.failure.field).toBe('jobId')
    expect(notACheckpoint.error.failure.cid).toBe(encoded.cid.toString())

    // And the other arm of the same union: a handle whose block nobody holds.
    const absent = await canonicalCid({ nobody: 'wrote this' })
    expect(absent.ok).toBe(true)
    if (!absent.ok) return
    const missing = await submitJob(specOver([honest('a')]), store, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
      resumeFrom: [absent.cid],
    })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.error.kind).toBe('checkpoint-unreadable')
    if (missing.error.kind !== 'checkpoint-unreadable') return
    expect(missing.error.failure.kind).toBe('block-missing')

    // WHAT THIS CANNOT REDDEN ON: `readCheckpoint`'s field-by-field validation, which
    // `checkpoint.test.ts` holds. What it says is that `submitJob` carries the union out
    // instead of throwing, and instead of quietly running the whole job — which is the
    // failure mode a caller could not tell from success.
  })

  it('refuses a valid checkpoint that belongs to ANOTHER job, rather than skipping partitions by number', async () => {
    const store = new MemoryBlockstore()
    const log = recorder()
    // A different job over different inputs, but the same shard count — so every partition
    // index in its checkpoint is in range for the job below, and nothing but the derived
    // job id can tell the two apart.
    const otherJob: JobSpec = {
      ...specOver([honest('a'), honest('b')]),
      shards: Array.from({ length: SHARDS }, (_, i) => ({
        value: { somethingElse: 'entirely', partition: i } as CanonicalValue,
        label: 'public' as const,
      })),
    }
    const other = await submitJob(otherJob, store, { clock: frozenClock(64), checkpoints: log.sink })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    expect(log.handles).toHaveLength(SHARDS)

    const seen: number[] = []
    const wrong = await submitJob(specOver([counting('d', seen), counting('e', seen)]), store, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
      resumeFrom: [log.handles[SHARDS - 1] as CID],
    })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) return
    expect(wrong.error.kind).toBe('checkpoint-names-another-job')
    if (wrong.error.kind !== 'checkpoint-names-another-job') return
    expect(wrong.error.found).not.toBe(wrong.error.expected)
    // Nothing ran. The refusal is before placement, so a resume against the wrong job does
    // not half-run it.
    expect(seen).toEqual([])
  })

  it('re-runs a shard whose named result block is gone, instead of reporting an answer nobody holds', async () => {
    const store = new MemoryBlockstore()
    const log = recorder()
    const first = await submitJob(specOver([honest('a'), honest('b')]), store, {
      clock: frozenClock(64),
      checkpoints: log.sink,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Partition 0's answer is named by the checkpoint and is no longer retrievable. A
    // resume that trusted the name alone would report a `resultCid` for a block this
    // requestor cannot hand to anybody.
    const lost = (first.job.shards[0] as ShardResult).verification
    expect(lost.status).toBe('agreed')
    if (lost.status !== 'agreed') return

    const seen: number[] = []
    const resumed = await submitJob(
      specOver([counting('d', seen), counting('e', seen)]),
      losing(store, lost.resultCid),
      { checkpoints: 'checkpoints-nothing', clock: frozenClock(64), resumeFrom: [log.handles[SHARDS - 1] as CID] },
    )
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return

    // Exactly the one shard, and it ran for real rather than being carried.
    expect(seen).toEqual([0])
    expect((resumed.job.shards[0] as ShardResult).ending).toBe('agreed')
    for (let i = 1; i < SHARDS; i++) {
      expect((resumed.job.shards[i] as ShardResult).ending).toBe('carried-from-checkpoint')
    }
    // And it produced the same bytes, because it is the same pure function of the same
    // input. Losing a block costs a recompute and never an answer.
    expect(cidsOf(resumed.job)).toEqual(cidsOf(first.job))
  })

  it('carries a resume forward: the resumed run’s checkpoints name what it inherited AND link back to the handle it resumed from', async () => {
    // A third requestor must not re-run the first requestor's work. That only holds if the
    // second requestor's checkpoints name what it carried as well as what it ran.
    const store = new MemoryBlockstore()
    const firstLog = recorder()
    const departed = await submitJob(
      specOver([refusing('a', OUTSTANDING), refusing('b', OUTSTANDING), refusing('c', OUTSTANDING)]),
      store,
      { clock: frozenClock(256), checkpoints: firstLog.sink },
    )
    expect(departed.ok).toBe(true)
    if (!departed.ok) return
    const inherited = firstLog.handles[firstLog.handles.length - 1] as CID

    const secondLog = recorder()
    const resumed = await submitJob(specOver([honest('d'), honest('e')]), store, {
      clock: frozenClock(64),
      resumeFrom: [inherited],
      checkpoints: secondLog.sink,
    })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return

    // Four writes for the four shards it ran, and the first of them already names seven:
    // the three it inherited plus its own. A log that started from empty would name one.
    expect(secondLog.handles).toHaveLength(4)
    expect(secondLog.written.map((checkpoint) => checkpoint.completed.length)).toEqual([5, 6, 7, 8])
    // The chain crosses the hand-off, which is what `checkpointChain` needs to walk a
    // job's whole history rather than only the part one requestor saw.
    expect((secondLog.written[0] as JobCheckpoint).previous).toBe(inherited.toString())
    // And a third requestor resuming from the newest handle has nothing left to do.
    const seen: number[] = []
    const third = await submitJob(specOver([counting('f', seen), counting('g', seen)]), store, {
      // CHURN-03 — this test asserts nothing about checkpointing.
      checkpoints: 'checkpoints-nothing',
      clock: frozenClock(64),
      resumeFrom: [secondLog.handles[3] as CID],
    })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(seen).toEqual([])
    expect(cidsOf(third.job)).toEqual(cidsOf(resumed.job))
  })
})

/**
 * WIRE-04 — the fabric has exactly one job entry point, held as a check.
 *
 * ## No test in this repository held this until 2026-08-05, and that is the finding
 *
 * `runResilient` was a **complete second job implementation** — its own options type, its
 * own outcome type, its own placement, lease, speculation and coverage machinery, 25
 * kernel cases of its own — re-exported from `@o2/core` beside `submitJob` for the whole
 * of Phases 7 through 20. WIRE-04's wording is that submitting a job gets lease renewal,
 * speculation and coverage accounting *"without the caller choosing between two
 * functions"*, and a barrel export is exactly a caller's choice. **Measured before the
 * deletion: the whole suite was green with it exported** — `npx vitest run --project node`
 * and `--project browser` both passed. Nothing anywhere read the barrel and objected. So
 * the requirement's own failure mode was invisible to the test suite for thirteen phases,
 * and the answer is a guard rather than a note in a summary.
 *
 * ## Why the namespace and not the source text
 *
 * A grep over `index.ts` reads what the file *looks like*. This reads what it *exports*:
 * `Object.keys` over a namespace import yields the value bindings and nothing else —
 * types have already vanished — so a comment naming a deleted symbol cannot register, and
 * a re-export added by any syntax at all does. The barrel's own header now names
 * `runResilient` twice in prose, which is precisely the shape a text scan gets wrong.
 *
 * ## The predicate, and its honest limit
 *
 * "Runs a job" is not decidable from a binding, so this pins a **set**: every exported
 * callable whose name takes an imperative job-shaped form. A new second entry point
 * called `runResilient`, `submitWork` or `executeJob` fails here on the day it is added.
 * One called `fabricate` does not — and that is stated rather than papered over, because
 * a guard that claims more than it checks is worse than the gap. What backs it up is the
 * argument on each surviving name below: four of the five are components of the one path
 * or belong to a different layer, and each says which.
 */
describe('WIRE-04 — the barrel offers exactly one way to run a job', () => {
  /**
   * The shape a job entry point's name takes. Deliberately wider than `submit`: the
   * symbol this guard exists because of was called `runResilient`, so a pattern that only
   * caught `submit*` would have been written by looking at the answer.
   */
  const JOB_SHAPED = /^(run|submit|execute|dispatch|perform)[A-Z]/

  /** Exported callables whose name takes that form, sorted. A pure function, so it can be planted against. */
  function jobShapedExports(namespace: Readonly<Record<string, unknown>>): string[] {
    return Object.keys(namespace)
      .filter((name) => JOB_SHAPED.test(name) && typeof namespace[name] === 'function')
      .sort()
  }

  /**
   * The whole set, each with the reason it is not a second job entry point.
   *
   * - `submitJob` — **the** entry point. Four production submitters call it.
   * - `executeVerified` — one shard's replicas, compared. A *component* `submitJob` calls
   *   once per generation; it takes a task and executors, not a job, and returns no
   *   `JobResult`. A caller reaching it directly gets no placement, no lease and no
   *   coverage, which is not a job by this requirement's definition.
   * - `executeReduce` — the *reduce* half of map/reduce, over partials a job already
   *   produced. A different phase of the same pipeline, not a rival way to run the map.
   * - `runTask` / `runTaskAndPost` — the **worker** side: what a node does with one task
   *   it has been handed. The opposite end of the wire from a requestor submitting a job.
   */
  const JOB_SHAPED_EXPORTS: readonly string[] = [
    'executeReduce',
    'executeVerified',
    'runTask',
    'runTaskAndPost',
    'submitJob',
  ]

  it('exports submitJob and no second job runner beside it', async () => {
    const barrel = (await import('../index.ts')) as unknown as Readonly<Record<string, unknown>>

    // Anti-vacuity: the barrel really was loaded and really does publish a lot. Without
    // this, an import that resolved to an empty object would satisfy a "no second runner"
    // reading perfectly.
    expect(Object.keys(barrel).length).toBeGreaterThan(100)
    expect(typeof barrel['submitJob']).toBe('function')

    // A set equality, not a `not.toContain('runResilient')`. The regression this exists
    // for is *a second entry point*, and naming the one that already happened would guard
    // against history rather than against recurrence.
    expect(jobShapedExports(barrel)).toStrictEqual([...JOB_SHAPED_EXPORTS])
  })

  it('reports a second job runner when one is put back — proved by planting, not assumed', async () => {
    const barrel = (await import('../index.ts')) as unknown as Readonly<Record<string, unknown>>

    // `runResilient` restored to the barrel, which is exactly the state this repository
    // was in until Plan 20-12 and which the whole suite tolerated.
    const planted: Record<string, unknown> = { ...barrel, runResilient: () => undefined }
    expect(jobShapedExports(planted)).toStrictEqual(
      [...JOB_SHAPED_EXPORTS, 'runResilient'].sort(),
    )
    expect(jobShapedExports(planted)).not.toStrictEqual([...JOB_SHAPED_EXPORTS])

    // And the other direction: losing the one entry point is a failure too, not merely
    // the addition of a second. A barrel exporting no way to run a job satisfies
    // "exactly one" only if the check counts rather than forbids.
    const withoutSubmit: Record<string, unknown> = { ...planted }
    delete withoutSubmit['submitJob']
    expect(jobShapedExports(withoutSubmit)).not.toContain('submitJob')
    expect(jobShapedExports(withoutSubmit)).not.toStrictEqual([...JOB_SHAPED_EXPORTS])
  })
})
