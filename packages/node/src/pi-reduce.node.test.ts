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
import {
  PI_PARTIAL_KEY,
  buildPiInput,
  estimatePi,
  piErrorBound,
  piKernelBytes,
  projectPiPartial,
  readPiPartial,
} from '@o2/demo'
import { FetchingBlockstore, RemoteExecutor, RpcBlockSource, RpcEndpoint, reduceJob, serveAgent } from '@o2/net'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'

/**
 * Estimating pi across the fabric by splitting a series over shards, and checking the
 * result against the published value of the constant.
 *
 * **Why this file exists when `primes-reduce.node.test.ts` already distributes against a
 * published oracle.** It is the complement of that file rather than a second copy of it,
 * and the reason is a weakness that file *measured* in its own oracle.
 *
 * pi(x) is tabulated at powers of ten, and a power of ten sits a long way from the prime
 * below it — 999983, 99991, 9973. So a guest that loses the top of its range still
 * returns the right total, because the numbers it dropped contained no primes. Planted
 * against `primes.wat`, that defect died at n = 1000 and survived every larger bound at
 * every shard count. The oracle is real and independent, and it is blind in one specific
 * direction.
 *
 * This series has no such gap, because **every term is non-zero**. Where the prime
 * count's dropped numbers hold no primes — so the total is unchanged at *every* shard
 * count and no cross-shard comparison helps either — a lost term here moves the total by
 * around five hundred million units.
 *
 * ## The same mutation, planted here, and what it actually showed
 *
 * Both `$min_u` call sites in `pi.wat` were replaced with `(i32.const 0)` and this file
 * re-run:
 *
 *   caught by   `gives a bit-identical scaled total…`, at **shard count 2**, the first
 *               tried — 785397913397978 against 785398413396728
 *   caught by   `splits into distinct partials, of both signs`
 *   NOT caught  either case comparing against published pi. Both passed.
 *
 * **The oracle missing it is the finding.** At eight shards a term count of 1 000 003
 * leaves a remainder of three, so three tail terms are lost; their signs alternate and
 * mostly cancel, leaving about 2e-6 of error in pi against a remainder bound of 2.0e-6.
 * It passed underneath by a hair.
 *
 * So the published constant is necessary and not sufficient — the same shape of result
 * the prime workload produced, reached by a different route. The falsifying power sits
 * in the decomposition cases below, and they are not decoration around the oracle.
 *
 * ---
 *
 * ## The term count is deliberately not a round number, for the mirror-image reason
 *
 * `primes-reduce` learned that a round bound sits in a prime desert. The equivalent trap
 * here is arithmetic rather than number-theoretic: **a term count divisible by the shard
 * count leaves no remainder**, and the range split's remainder handling — the `min_u`
 * term that hands the first `rem` shards one extra index each — is then doing nothing at
 * all. Delete it and every total stays correct, because there was nothing to distribute.
 *
 * So `TERMS` is 1 000 003, chosen because it leaves a non-zero remainder against every
 * shard count from 2 to 8:
 *
 *   count  2  3  4  5  6  7  8
 *   rem    1  1  3  3  1  4  3
 *
 * A round 1 000 000 would divide exactly at 2, 4, 5 and 8 — half the sweep — and the
 * split defect would be invisible at each of them.
 */

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
 * Pi, quoted rather than computed.
 *
 * Twenty significant digits from the mathematical literature. **Nothing in this file
 * derives it** — there is deliberately no series implementation here, because a
 * reference written alongside the guest would put the repository back in the position of
 * checking its own work, one layer out. The literal *is* the oracle.
 *
 * As a JavaScript number this rounds to the same double as `Math.PI`; the digits are
 * written out anyway, so the oracle is visible in the source rather than delegated to a
 * platform constant a reader would have to go and look up.
 */
const PI_PUBLISHED = 3.14159265358979323846

const SHARDS = 8

/** See the header. Non-round on purpose. */
const TERMS = 1_000_003

/**
 * Map redundancy: every shard is executed by two independent workers and their outputs
 * compared, rather than attested by one. A shard whose two executors disagree is
 * reported as `skipped` by `reduceJob` and fails the coverage assertion below — which is
 * the behaviour wanted, since a disagreement means the partial cannot be trusted into a
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
 * Identical in shape to `primes-reduce.node.test.ts`'s, and the 30 000 ms RPC budget is
 * a ceiling for a loaded machine rather than an estimate — the measured cost is orders
 * of magnitude below it. If a run ever exceeds it, check whether a shard is summing the
 * whole series rather than its own range, which is the defect that would make one
 * dispatch cost `SHARDS` times what it should.
 */
async function piFabric(count: number): Promise<Fabric> {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()
  const moduleCid = await originStore.put(piKernelBytes)

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
async function runMap(fabric: Fabric, terms: number, shards: number): Promise<JobResult> {
  // One block, identical for every shard. `submitJob` content-addresses it once, so all
  // `shards` tasks name the same input CID and a worker fetches it at most once. Shards
  // differ only by `partition()`.
  const input = buildPiInput(terms)

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
  )

  expect(submitted.ok).toBe(true)
  if (!submitted.ok) throw new Error('the map did not run')
  expect(submitted.job.complete).toBe(true)
  return submitted.job
}

/** Every shard's own scaled partial, in shard order. Throws if any shard did not agree. */
function shardPartials(job: JobResult): readonly number[] {
  return job.shards.map((shard) => {
    if (shard.verification.status !== 'agreed') {
      throw new Error(`shard ${shard.partitionIndex} did not agree: ${shard.verification.status}`)
    }
    return readPiPartial(shard.verification.output)
  })
}

/**
 * The scaled total the fabric's own aggregate carries, read back out of the root block.
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
  const total = partial.counts[PI_PARTIAL_KEY]
  if (total === undefined) throw new Error(`the aggregate carries no "${PI_PARTIAL_KEY}" value`)
  return { total, rows: partial.rows }
}

/** Map, then reduce, then read the aggregate — the whole path, once. */
async function runPi(
  fabric: Fabric,
  terms: number,
  shards: number,
): Promise<{ total: number; rows: number; perShard: readonly number[] }> {
  const job = await runMap(fabric, terms, shards)
  const perShard = shardPartials(job)

  const result = await reduceJob(job, {
    rpc: fabric.originRpc,
    executors: fabric.workerIds,
    blockstore: fabric.originStore,
    project: projectPiPartial,
    redundancy: REDUNDANCY,
    // Nothing in this fixture enrols, so every agent here holds no certificate and its
    // factory resolves `attest` to the sentinel. The no-checking literal is the truthful
    // statement of that; an issuer set would say this requestor checked signatures and
    // found none, which is a different and false claim about the run. This file measures
    // arithmetic across processes, not attestation.
    trustedIssuers: 'checks-no-combine-signatures',
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
 * 120 s. A ceiling for a loaded machine, not an estimate of the work. If a run exceeds
 * it, do not raise it before checking whether a shard is summing the whole series
 * instead of its own range.
 */
const TEST_TIMEOUT = 120_000

describe('the fabric estimates pi and the estimate matches the published constant', () => {
  /**
   * Convergence across four term counts, each checked against the rigorous remainder
   * bound rather than a tuned threshold.
   *
   * The bound is a property of alternating series, not of this project: for terms
   * decreasing monotonically to zero, the error after N terms is no larger than the
   * first term omitted. `piErrorBound` is that statement and nothing else, so an
   * assertion against it tests the fabric's arithmetic rather than a number somebody
   * adjusted until the suite went green.
   */
  it('lands inside the series remainder bound at every term count, over eight shards', async () => {
    const fabric = await piFabric(SHARDS)
    try {
      for (const terms of [1_003, 10_007, 100_003, 1_000_003]) {
        const { total, rows } = await runPi(fabric, terms, SHARDS)
        const estimate = estimatePi(total)
        const error = Math.abs(estimate - PI_PUBLISHED)

        expect({ terms, inside: error <= piErrorBound(terms) }).toEqual({ terms, inside: true })
        expect(rows).toBe(SHARDS)
      }
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)

  /**
   * **The estimate must also be wrong, by about the amount the mathematics predicts.**
   *
   * This is the case that stops the file being satisfiable by a guest that returns the
   * constant. An upper bound alone is passed perfectly by a kernel that ignores its
   * input and emits pi — the error would be zero, which is comfortably inside every
   * tolerance above. So the error is bounded from below as well.
   *
   * A quarter of the remainder bound is the floor. The true ratio is about a half —
   * the error of a Leibniz partial sum after N terms is close to 1/N while the bound is
   * 2/N — so a quarter leaves room for the guest's own fixed-point truncation without
   * leaving room for an answer that did not come from summing the series. That
   * truncation is at most one unit in 10^15 per term, four orders of magnitude below the
   * gap being asserted.
   */
  it('is wrong by roughly the predicted remainder, so it cannot be the constant itself', async () => {
    const fabric = await piFabric(SHARDS)
    try {
      for (const terms of [1_003, 10_007, 100_003]) {
        const { total } = await runPi(fabric, terms, SHARDS)
        const error = Math.abs(estimatePi(total) - PI_PUBLISHED)
        const bound = piErrorBound(terms)

        expect({ terms, aboveFloor: error >= bound / 4 }).toEqual({ terms, aboveFloor: true })
        expect({ terms, belowBound: error <= bound }).toEqual({ terms, belowBound: true })
      }
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)
})

describe('the decomposition is sound, not merely self-consistent', () => {
  /**
   * The same term count at every shard count from 1 to 8, required to give the **same
   * integer** every time.
   *
   * This is the case with the falsifying power, and it is strictly stronger than the
   * prime count's equivalent. There the check is that a total matches a published value,
   * which a guest losing the top of its range can still satisfy. Here the scaled total
   * is an exact integer and every term is non-zero, so any shard whose range gains or
   * loses a single index changes it — at every shard count, not at a lucky few.
   *
   * It holds at all because the sign of a term is taken from the *global* index, never
   * from a position within the shard. Term k has the same value and the same sign
   * whichever shard computes it, so the partials add back to one number regardless of
   * how the domain was cut. A sign taken from a shard-local counter would give a
   * different answer for every split, and this case is what would catch it.
   *
   * One fabric serves the whole sweep. Shard count and worker count are independent —
   * `submitJob` places shards across whatever nodes it is given — so varying only the
   * shard count keeps the fabric constant and the split the sole variable.
   */
  it('gives a bit-identical scaled total at every shard count from one to eight', async () => {
    const fabric = await piFabric(SHARDS)
    try {
      let reference: number | undefined
      for (let shards = 1; shards <= SHARDS; shards++) {
        const { total, rows, perShard } = await runPi(fabric, TERMS, shards)

        reference ??= total
        expect({ shards, total }).toEqual({ shards, total: reference })
        expect(rows).toBe(shards)

        // The fabric's aggregate must be the sum of the parts the fabric reported, not
        // merely a number that happens to be right. A combiner that dropped a leaf and
        // a guest that double-counted one would agree with the published constant while
        // disagreeing here.
        expect(perShard).toHaveLength(shards)
        expect(perShard.reduce((a, b) => a + b, 0)).toBe(total)
      }
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)

  /**
   * The partials are genuinely different work, and at least one of them is negative.
   *
   * A negative partial is what proves the sign is being carried across the shard
   * boundary rather than restarted at each one: a range beginning at an odd global index
   * opens with a subtraction. If every partial came back positive, each shard would be
   * summing its own alternating series from scratch — the totals could still add to
   * something plausible, and the answer would be wrong in a way no aggregate check
   * would see.
   */
  it('splits into distinct partials, of both signs', async () => {
    const fabric = await piFabric(SHARDS)
    try {
      const { perShard } = await runPi(fabric, TERMS, SHARDS)

      expect(new Set(perShard).size).toBe(SHARDS)
      expect(perShard.some((p) => p < 0)).toBe(true)
      expect(perShard.some((p) => p > 0)).toBe(true)
    } finally {
      fabric.close()
    }
  }, TEST_TIMEOUT)
})

describe('a shard that could not run is named, never summed', () => {
  /**
   * The refusal encoding, checked directly rather than through a fabric.
   *
   * Zero is an ordinary partial for this workload in a way it is not for a prime count —
   * an alternating series crosses zero constantly — so a refusal that returned zero
   * would be indistinguishable from a real contribution *and* would look entirely
   * plausible. The guest emits a status byte for that reason and the host throws on it.
   */
  it('throws on a refused shard instead of contributing its zero', () => {
    const refused: CanonicalValue = {
      p: new Uint8Array(8),
      s: Uint8Array.of(1),
    }
    expect(() => readPiPartial(refused)).toThrow(/refused this shard/)
  })

  it('reads a zero partial that the guest agreed to as an ordinary value', () => {
    const agreed: CanonicalValue = {
      p: new Uint8Array(8),
      s: Uint8Array.of(0),
    }
    expect(readPiPartial(agreed)).toBe(0)
  })

  it('refuses an output whose partial field is the wrong width', () => {
    const short: CanonicalValue = { p: new Uint8Array(4), s: Uint8Array.of(0) }
    expect(() => readPiPartial(short)).toThrow(/not a pi partial/)
  })
})
