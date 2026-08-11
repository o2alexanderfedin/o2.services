import {
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  asFabricPartial,
  decodeCanonical,
  publicNodes,
  submitJob,
} from '@o2/core'
import type { Blockstore, CanonicalValue, JobResult } from '@o2/core'
import { PRIME_COUNT_KEY, buildPrimesInput, primesKernelBytes, projectPrimeCount, readPrimeCount } from '@o2/demo'
import { FetchingBlockstore, RemoteExecutor, RpcBlockSource, RpcEndpoint, reduceJob, serveAgent } from '@o2/net'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'

/**
 * Counting the primes below N across the fabric, and checking the total against π(x)
 * as published in the mathematical literature.
 *
 * **What makes this file different from every other workload in the repository.** The
 * colouring job is checked by `verifyColouring`; the reduce is checked bit-for-bit
 * against `fabricCombiner` called once in this process; `two-process.node.test.ts`
 * compares processes against an in-process twin. Every one of those oracles was written
 * *here*. They are good checks — a re-derivation from the definition is a strong one —
 * but the fabric and its oracle share an author, so a misconception held in both is
 * invisible to the pair: they would be wrong together and agree.
 *
 * π(x) has no such weakness. The constants below were tabulated long before this
 * project existed and are quoted, not computed. **Nothing in this file recomputes them**
 * — there is deliberately no JavaScript sieve here, because a reference implementation
 * written alongside the guest would put the repository back in the position of checking
 * its own work, one layer out. The literal *is* the oracle.
 *
 * ---
 *
 * **π(10^n) at a single shard count is a weaker check than it looks, and the sweep
 * below exists because of a measurement rather than a hunch.**
 *
 * A mutation was planted in the guest's range split — the `min(i, rem)` term that hands
 * the first `rem` shards one extra number each — reducing it to `lo(i) = 2 + i*chunk`.
 * That leaves the top `total mod count` numbers of [2, N] **covered by no shard at
 * all**. It is exactly the boundary defect this workload should catch, and measured
 * against the four quoted bounds at shard counts 1 through 8 it was caught at
 * **n = 1000 only**, and there only at shard counts 5, 7 and 8:
 *
 * | bound | caught at shard counts |
 * |---|---|
 * | 1 000 | 5, 7, 8 |
 * | 10 000 | none |
 * | 100 000 | none |
 * | 1 000 000 | none |
 *
 * The reason is a property of the *oracle*, not of the fabric: a power of ten is a long
 * way from the prime below it — 999 983 for 10^6, 99 991 for 10^5, 9 973 for 10^4 — so
 * an uncovered tail of at most `count` numbers contains no prime and the total comes out
 * right anyway. At 1000 the nearest prime is 997, three below the bound, and the tail
 * reaches it.
 *
 * So a headline assertion at 10^6 and eight shards **passes a guest that loses the top
 * of the range**. The `tiles [2, N] exactly` case below is what closes that, and it is
 * cheap precisely because the bound that catches the defect is the smallest one.
 *
 * ---
 *
 * **The assertions, and what each alone fails to exclude.**
 *
 * 1. **The total equals π(N).** Alone, satisfiable by a guest that ignores
 *    `partition()` — a one-shard job would pass — and, per the table above, by a guest
 *    that drops the top of the range.
 * 2. **The same N gives the same total at every shard count from 1 to 8.** This is what
 *    makes the decomposition sound rather than the arithmetic merely self-consistent.
 *    The sub-ranges must tile [2, N] exactly at *each* count, which is a strictly
 *    stronger claim than any single split being right.
 * 3. **At least one shard's count is non-zero, and no shard holds the whole total.** A
 *    fabric that silently ran nothing and summed zeros fails the first half; one that
 *    ignored the partition and had a single node count everything fails the second.
 *
 * ---
 *
 * **One process, eight in-process endpoints — this is not a distributed-hardware
 * result.** `tree-reduce-agents.node.test.ts` is the file that makes the OS-process
 * claim, spawning eight real `bin/agent.ts` children; this one deliberately does not
 * re-make that claim and must never be read as making it. What it measures is the
 * *arithmetic* of a distributed map/reduce — decomposition, dispatch, verification, tree
 * combine, aggregate — against an external oracle, over the production code path: real
 * `serveAgent` handlers, a real `WasmExecutor` per worker, real `submitJob`
 * verification, and the real `reduceJob` driver with its production
 * `remoteCombineDispatch`. Every worker's block source is
 * `RpcBlockSource(rpc, () => ['origin'])` over an origin serving a plain
 * `MemoryBlockstore`, so **no worker can see another worker's store** — the topology of
 * every fabric in this repository.
 *
 * The choice is also a resource one, stated rather than hidden: eight OS processes plus
 * a submitter is what the process-level file already covers, and duplicating that cost
 * here would buy a boundary this file is not about.
 */

/** The seven sentinels every `AgentOptions` must write down. */
const SENTINELS = {
  egress: 'holds-no-registrations',
  authorize: 'serves-unauthenticated',
  index: 'serves-no-records',
  capacity: 'accepts-every-offer',
  ledger: 'keeps-no-ledger',
  reservations: 'relays-for-nobody',
  onDispatch: 'reports-no-dispatch',
  attest: 'signs-nothing',
  enroll: 'issues-no-certificates',
} as const

/**
 * π(x) — the number of primes not exceeding x.
 *
 * **Quoted from the mathematical literature, never computed here.** These are the
 * standard π(10^n) values, as carried by Wikipedia's "Prime-counting function" table
 * and by every introductory number theory text (e.g. Hardy & Wright, *An Introduction
 * to the Theory of Numbers*, §1.8); π(10^6) = 78 498 is the figure D. H. Lehmer's 1959
 * tabulation confirmed.
 *
 * Literals on purpose. Deriving them from a JavaScript sieve written in this file would
 * make the test compare the fabric against a second implementation by the same author —
 * exactly the weakness this workload exists to remove.
 */
const PI: { readonly [bound: number]: number } = {
  1_000: 168,
  10_000: 1229,
  100_000: 9592,
  1_000_000: 78498,
}

/**
 * The bound the headline case uses.
 *
 * 10^6, the largest of the quoted constants, and still cheap: a segmented sieve over a
 * million integers, split eight ways and run twice over for verification. Raising it is
 * available through `O2_PRIMES_N` for a deliberate measurement and is **not** taken by
 * default — a suite that quietly sized itself to the machine would report a different
 * thing on every host.
 *
 * A value passed through the environment must still be one of the quoted constants,
 * because the oracle is the table and not a formula. Anything else is refused rather
 * than checked against a number nobody looked up.
 */
const DEFAULT_BOUND = 1_000_000

function boundUnderTest(): number {
  const requested = process.env['O2_PRIMES_N']
  if (requested === undefined) return DEFAULT_BOUND
  const n = Number(requested)
  if (PI[n] === undefined) {
    throw new Error(`O2_PRIMES_N must be one of ${Object.keys(PI).join(', ')} — those are the bounds π(x) is quoted for`)
  }
  return n
}

/**
 * Shard count for the headline run, and the ceiling for every run in this file.
 *
 * Eight matches the shard count the reduce tests use, so the derived tree has the same
 * shape (8 leaves, 3 nodes, depth 2) and a failure here can be told apart from a tree
 * that came out differently.
 */
const SHARDS = 8

/**
 * Map redundancy: every shard is executed by two independent workers and their outputs
 * compared, rather than attested by one. A shard whose two executors disagree is
 * reported as `skipped` by `reduceJob` and fails the coverage assertion below — which is
 * the behaviour wanted, since a disagreement means the count cannot be trusted into a
 * sum.
 */
const REDUNDANCY = 2

interface Fabric {
  readonly originStore: MemoryBlockstore
  readonly originRpc: RpcEndpoint
  readonly moduleCid: CID
  readonly workerIds: readonly string[]
  readonly executors: readonly RemoteExecutor[]
  readonly close: () => void
}

/**
 * A fabric of `count` workers that can reach the origin and nobody else.
 *
 * `timeoutMs` is 30 000 rather than `reduce-job.test.ts`'s 5 000, and the reason is the
 * workload rather than the transport: a shard here runs a real sieve, and the RPC budget
 * has to cover the slowest one on a *loaded* machine, not the median on an idle one. It
 * is a ceiling, not an estimate — the measured cost is three orders of magnitude below
 * it. If a run ever exceeds it, the thing to check is whether a shard is sieving the
 * whole range rather than its own, which is the defect that would make one dispatch cost
 * `SHARDS` times what it should.
 */
async function primeFabric(count: number): Promise<Fabric> {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()
  const moduleCid = await originStore.put(primesKernelBytes)

  const originRpc = new RpcEndpoint(network.connect('origin'), { timeoutMs: 30_000 })
  serveAgent({
    ...SENTINELS,
    rpc: originRpc,
    executor: new WasmExecutor({ nodeId: 'origin', blockstore: originStore }),
    blockstore: originStore,
  })

  const rpcs: RpcEndpoint[] = [originRpc]
  const workerIds: string[] = []
  for (let i = 0; i < count; i++) {
    const id = `w${i}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 30_000 })
    // The worker holds nothing to begin with: it pulls the module and its shard input
    // from the origin by CID. Nothing is pushed to it.
    const store = new FetchingBlockstore(new MemoryBlockstore(), new RpcBlockSource(rpc, () => ['origin']))
    serveAgent({ ...SENTINELS, rpc, executor: new WasmExecutor({ nodeId: id, blockstore: store }), blockstore: store })
    rpcs.push(rpc)
    workerIds.push(id)
  }

  const executors = workerIds.map((id) => new RemoteExecutor(id, originRpc, 'dispatches-unauthenticated'))

  return {
    originStore,
    originRpc,
    moduleCid,
    workerIds,
    executors,
    close: () => {
      for (const rpc of rpcs) rpc.close()
    },
  }
}

/** Dispatch the map phase, and refuse to proceed unless every shard agreed. */
async function runMap(fabric: Fabric, bound: number, shards: number): Promise<JobResult> {
  // One block, identical for every shard — the colouring job's arrangement, reused.
  // `submitJob` content-addresses it once, so all `shards` tasks name the same input CID
  // and a worker fetches it at most once. Shards differ only by `partition()`.
  const input = buildPrimesInput(bound)

  const submitted = await submitJob(
    {
      moduleCid: fabric.moduleCid,
      shards: Array.from({ length: shards }, () => ({ value: input, label: 'public' as const })),
      executors: fabric.executors,
      nodes: publicNodes(fabric.executors),
      redundancy: REDUNDANCY,
      onQuorumShortfall: 'runs-at-available-redundancy',
    },
    fabric.originStore,
    // CHURN-03 — this test asserts nothing about checkpointing.
    { checkpoints: 'checkpoints-nothing' },
  )

  expect(submitted.ok).toBe(true)
  if (!submitted.ok) throw new Error('the map did not run')
  expect(submitted.job.complete).toBe(true)
  return submitted.job
}

/** Every shard's own count, in shard order. Throws if any shard did not agree. */
function shardCounts(job: JobResult): readonly number[] {
  return job.shards.map((shard) => {
    if (shard.verification.status !== 'agreed') {
      throw new Error(`shard ${shard.partitionIndex} did not agree: ${shard.verification.status}`)
    }
    return readPrimeCount(shard.verification.output)
  })
}

/**
 * The count the fabric's own aggregate carries, read back out of the root block.
 *
 * The root is fetched into the requestor's store by `remoteCombineDispatch`, so this
 * reads the bytes a *combine node* produced rather than anything computed here. Going
 * through `asFabricPartial` rather than casting is deliberate: it is the same predicate
 * the wire uses, so a root that is not a well-formed partial is named here instead of
 * being indexed into.
 */
async function aggregateOf(store: Blockstore, rootCid: string | null): Promise<{ total: number; rows: number }> {
  if (rootCid === null) throw new Error('the reduce produced no root')
  const bytes = await store.get(CID.parse(rootCid))
  if (bytes === undefined) throw new Error('the root block is not resident at the requestor')
  const partial = asFabricPartial(decodeCanonical(bytes))
  if (partial === null) throw new Error('the root block is not a {counts, rows} partial')
  const total = partial.counts[PRIME_COUNT_KEY]
  if (total === undefined) throw new Error(`the aggregate carries no "${PRIME_COUNT_KEY}" count`)
  return { total, rows: partial.rows }
}

/** Map, then reduce, then read the aggregate — the whole path, once. */
async function countPrimes(
  fabric: Fabric,
  bound: number,
  shards: number,
): Promise<{ total: number; rows: number; perShard: readonly number[] }> {
  const job = await runMap(fabric, bound, shards)
  const perShard = shardCounts(job)

  const result = await reduceJob(job, {
    rpc: fabric.originRpc,
    executors: fabric.workerIds,
    blockstore: fabric.originStore,
    project: projectPrimeCount,
    redundancy: REDUNDANCY,
    // Nothing in this fixture enrols, so every agent here holds no certificate and its
    // factory resolves `attest` to the sentinel. The no-checking literal is the truthful
    // statement of that; an issuer set would say this requestor checked signatures and
    // found none, which is a different and false claim about the run. This file measures
    // arithmetic across processes, not attestation.
    trustedIssuers: 'checks-no-combine-signatures',
    // MR-02 — every shard here is public, so a partial is attributed to its own partition
    // index and to no owner. `reduceSovereignJob` is where a leaf is keyed on an owner.
    contributors: 'attributes-each-shard-to-its-own-partition-index',
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`the reduce did not start: ${result.reason}`)

  // A partial aggregate presented as a complete one is the failure mode this repository
  // builds `CoveredAggregate` to prevent. Every shard must have contributed a leaf.
  expect(result.skipped).toEqual([])
  expect(result.leaves).toHaveLength(shards)
  expect(result.outcome.ok).toBe(true)
  expect(result.outcome.failed).toEqual([])
  // A disagreement is a failed reduce, not a reduce with a footnote.
  expect(result.outcome.disagreements).toEqual([])

  const { total, rows } = await aggregateOf(fabric.originStore, result.outcome.rootCid)
  return { total, rows, perShard }
}

/**
 * 120 s. A ceiling for a loaded machine, not an estimate of the work — the measured cost
 * is recorded in this plan's summary and is orders of magnitude below it. If a run
 * exceeds this, do not raise it before checking whether a shard is sieving the whole
 * range instead of its own.
 */
const TEST_TIMEOUT = 120_000

describe('the fabric counts the primes below N and the total matches π(N) as published', () => {
  it('agrees with the tabulated value at every quoted bound, over eight shards', async () => {
    const fabric = await primeFabric(SHARDS)
    try {
      // All four quoted bounds through one fabric. Running every bound rather than only
      // the headline one costs almost nothing — 10^6 dominates the wall clock — and the
      // smallest is the one that carries the falsifying power, per the table in this
      // file's header.
      for (const bound of Object.keys(PI).map(Number).sort((a, b) => a - b)) {
        const expected = PI[bound] as number
        const { total, rows, perShard } = await countPrimes(fabric, bound, SHARDS)

        // **The measurement.** Nothing in this process computed the right-hand side.
        expect(total).toBe(expected)

        // The aggregate says how many sub-ranges it covers, and it must be all of them.
        // Without this a reduce that dropped a shard whose count happened to be zero
        // would be indistinguishable from one that did not.
        expect(rows).toBe(SHARDS)

        // Every shard reported, and the parts account for the whole. Weaker than the
        // line above and kept because it localises a failure: a mismatch here indicts
        // the combine, while a mismatch above with this line green indicts the map.
        expect(perShard).toHaveLength(SHARDS)
        expect(perShard.reduce((a, b) => a + b, 0)).toBe(expected)

        // **A fabric that silently ran nothing and summed zeros cannot pass this.**
        expect(perShard.some((count) => count > 0)).toBe(true)

        // **And one that ignored `partition()` and had a single node count everything
        // cannot pass this.** Every shard owns a strict sub-range, so no shard may hold
        // the whole answer. Together with the line above, this is what makes the total a
        // measurement of a *distributed* count rather than of one node's.
        expect(perShard.every((count) => count < expected)).toBe(true)
      }
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)

  it('agrees at the bound named by O2_PRIMES_N, which defaults to 10^6', async () => {
    const bound = boundUnderTest()
    const fabric = await primeFabric(SHARDS)
    try {
      const { total } = await countPrimes(fabric, bound, SHARDS)
      expect(total).toBe(PI[bound] as number)
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)
})

describe('the decomposition is sound, not merely self-consistent', () => {
  /**
   * The same N at every shard count from 1 to 8.
   *
   * **This is the case with the falsifying power, and n = 1000 is chosen for that reason
   * rather than for cheapness** — see the measured table in this file's header. A guest
   * whose sub-ranges leave a gap or overlap can still tile correctly at one particular
   * shard count; it cannot do so at eight of them. The planted range-split mutation
   * survives 10^4, 10^5 and 10^6 at every shard count and dies here at 5, 7 and 8.
   *
   * Sweeping rather than checking two counts is deliberate: at which counts a boundary
   * defect becomes visible depends on `N mod count` and on where the primes near N fall,
   * neither of which is knowable in advance from the shard count alone.
   *
   * One fabric serves the whole sweep. Shard count and worker count are independent —
   * `submitJob` places shards across whatever nodes it is given — so varying only the
   * shard count keeps the fabric constant and the split the sole variable.
   */
  it('tiles [2, N] exactly at every shard count from one to eight', async () => {
    const bound = 1_000
    const expected = PI[bound] as number

    const fabric = await primeFabric(SHARDS)
    try {
      for (let shards = 1; shards <= SHARDS; shards++) {
        const { total, rows, perShard } = await countPrimes(fabric, bound, shards)
        expect({ shards, total }).toEqual({ shards, total: expected })
        expect(rows).toBe(shards)
        expect(perShard.reduce((a, b) => a + b, 0)).toBe(expected)
      }
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)

  /**
   * The same N at four shards and at eight, at a bound large enough that the two splits
   * are genuinely different work — 249 999 numbers per shard against 124 999.
   *
   * Kept alongside the sweep above rather than folded into it because it is the reading
   * a person actually asks for: does splitting the same job more ways give the same
   * answer. The sweep is the stronger instrument; this is the legible one.
   */
  it('gives the same total at four shards and at eight', async () => {
    const bound = 100_000
    const expected = PI[bound] as number

    const fabric = await primeFabric(SHARDS)
    try {
      const four = await countPrimes(fabric, bound, 4)
      const eight = await countPrimes(fabric, bound, SHARDS)

      expect(four.total).toBe(eight.total)
      // Named separately from the equality: two runs agreeing on a wrong number would
      // satisfy the line above and nothing else here.
      expect(four.total).toBe(expected)
      expect(eight.total).toBe(expected)

      // The eight-way split really did split. Were `partition()` ignored, every shard
      // would report the whole count and this would read eight identical values.
      expect(eight.perShard).toHaveLength(SHARDS)
      expect(new Set(eight.perShard).size).toBeGreaterThan(1)
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)
})

describe('a shard that could not run is named, never summed', () => {
  /**
   * The guest's refusal path, and the host's refusal to launder it.
   *
   * A refused shard emits a count of zero, which is byte-identical to a sub-range that
   * genuinely held no primes. If `readPrimeCount` returned that zero, the aggregate
   * would be short by exactly the primes the shard was supposed to count and **every
   * other assertion in this file would still pass** — the total would simply be wrong,
   * and π(x) is only checkable if you already know it.
   *
   * So the refusal is proved to throw. The frame is built here rather than obtained from
   * a guest, because the point is the host's disposition toward those bytes: the kernel
   * refuses on a version mismatch and on a bound above its own maximum, and both arrive
   * at the host as this shape.
   */
  it('throws on a refused shard instead of contributing its zero', () => {
    const frame = (status: number): CanonicalValue => ({
      c: new Uint8Array(8),
      s: Uint8Array.of(status),
    })

    expect(() => readPrimeCount(frame(1))).toThrow(/refused/)

    // The positive control: the identical frame with a status of 0 is an honest count of
    // zero and must be read, not rejected. Without this, a `readPrimeCount` that threw
    // unconditionally would pass the line above.
    expect(readPrimeCount(frame(0))).toBe(0)

    // And the projection carries the same disposition, since that is the function
    // `reduceJob` actually calls.
    expect(() => projectPrimeCount(frame(1))).toThrow(/refused/)
    expect(projectPrimeCount(frame(0))).toEqual({ counts: { [PRIME_COUNT_KEY]: 0 }, rows: 1 })
  })
})
