import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { Executor, ExecutionOutcome, Task } from '../ports.ts'
import { publicNodes } from '../sovereignty.ts'
import { submitJob } from './submit.ts'
import { commitmentDigest, executeVerified } from './verify.ts'

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

  it('treats an unencodable NaN output as that node failing, not as divergence', async () => {
    const r = await executeVerified(task, [honest('a'), nanProducer('b')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing).toEqual(['a'])
    }
  })
})

describe('commitmentDigest — covers (task, output) only (VER-05)', () => {
  it('is stable for the same nonce and result', async () => {
    const nonce = new Uint8Array([1, 2, 3, 4])
    const a = await commitmentDigest(nonce, MODULE_CID)
    const b = await commitmentDigest(nonce, MODULE_CID)
    expect(a).toBe(b)
  })

  it('changes when the result changes', async () => {
    const nonce = new Uint8Array([1, 2, 3, 4])
    const other = (await canonicalCid({ different: true })) as { ok: true; cid: CID }
    const a = await commitmentDigest(nonce, MODULE_CID)
    const b = await commitmentDigest(nonce, other.cid)
    expect(a).not.toBe(b)
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
