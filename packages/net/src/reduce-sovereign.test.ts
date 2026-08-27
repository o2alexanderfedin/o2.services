import {
  EnrollmentAuthority,
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  attestResults,
  attestationReceipt,
  requestEnrollment,
  submitJob,
} from '@o2/core'
import type {
  AttestationReceipt,
  CanonicalValue,
  JobResult,
  JobSpec,
  NodeCertificate,
  OwnerId,
  PublicKeyHex,
  ResultSigner,
  ShardResult,
} from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import, exactly as `distributed.test.ts` does it.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { RpcBlockSource, serveAgent } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
import type { EgressManifest } from './egress.ts'
import { MIN_SOVEREIGN_COMBINE_REPLICAS, reduceSovereignJob } from './reduce-sovereign.ts'
import type { SovereignEgressEvidence } from './reduce-sovereign.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * MR-02 — the sovereign arm of the aggregation, and every way it refuses.
 *
 * `PROJECT.md`'s split says *the owner's contribution is trusted; the aggregation over
 * contributions is verified*. Phase 16 built the aggregation and ran it over public
 * shards only, which leaves the sentence half-measured: nothing had ever aggregated a
 * partial that an owner computed over data pinned to that owner's own node.
 *
 * ## Why this file is mostly refusals
 *
 * `VER-02`'s predecessor was **deleted** rather than relabelled, because its check was
 * unconditionally true and both of its failure branches were unreachable — measured by
 * making the mismatch branch throw and running the whole node project without reaching
 * it. A sovereign-aggregation admission gate is the same shape of thing and would fail
 * the same way, so every branch below is exercised **and** was planted red. The plants
 * are recorded in this repository's mutation ledger and their watched text is quoted at
 * each case.
 *
 * ## What a literal fixture can and cannot carry here
 *
 * The receipts these fixtures put on a shard are built by `attestationReceipt` over
 * certificates a real `EnrollmentAuthority` issued, so `userKeys` is genuinely derived
 * from a signed statement rather than written down. What no in-process fixture can carry
 * is that the map *ran on the owner's own machine over data that never moved* — that is a
 * fact about processes and stores, and it is
 * `packages/node/src/sovereign-aggregation.node.test.ts`'s, across real `bin/agent.ts`
 * processes. Neither substitutes for the other.
 */

const FIXED_CID = CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')

/** The ten sentinels every `AgentOptions` must write down. */
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
  paused: 'never-pauses',
} as const

/** The provider that certifies both owners below. Seed 43 — 41/42 are `reduce-job.test.ts`'s. */
const PROVIDER_SEED = new Uint8Array(32).fill(43)
const authority = new EnrollmentAuthority({
  providerPrivateKey: PROVIDER_SEED,
  maxPerWindow: 100,
  maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
  issuance: 'remembers-only-within-this-process',
})

/**
 * A certificate for one owner's node, and the owner id that owner is known by.
 *
 * `ownerId` **is** `certificate.userKey` — the identity `discoverCandidates` builds a
 * descriptor's `ownerId` from — so this helper produces the two facts the arm compares
 * from one act, exactly as a real enrolment does.
 */
async function ownerNode(userByte: number, nodeByte: number, operatorId: string): Promise<{
  readonly ownerId: OwnerId
  readonly certificate: NodeCertificate
}> {
  const enrolled = authority.enrol(
    await requestEnrollment(new Uint8Array(32).fill(nodeByte), new Uint8Array(32).fill(userByte), {
      operatorId,
      discoverability: 'seed',
      relayIds: [],
    }),
    // The real clock, because the arm reads receipts that were verified at one. A fixed
    // fixture epoch would make every certificate expired for a reason unrelated to MR-02.
    Date.now(),
  )
  if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
  return { ownerId: enrolled.certificate.userKey, certificate: enrolled.certificate }
}

const ALICE = await ownerNode(0xd1, 0xd2, 'alice-op')
const BOB = await ownerNode(0xd3, 0xd4, 'bob-op')
/** A third party who owns nothing in these jobs. Used to make a foreign attestation. */
const MALLORY = await ownerNode(0xd5, 0xd6, 'mallory-op')

/** The map half's receipt, derived from certificates rather than written down. */
function receiptOver(certificates: readonly NodeCertificate[]): AttestationReceipt {
  return attestationReceipt(certificates)
}

/** The 4-byte little-endian partition index the guest fixture emits. */
function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) throw new Error('not a partition output')
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The projection. Derived from the output, never from the index — see
 * `reduce-job.test.ts`'s `project` for why a projection keyed on the index would make
 * every leaf a function of an integer the test process already holds.
 */
function project(output: CanonicalValue): CanonicalValue {
  return { counts: { [`partition-${String(partitionOf(output))}`]: 1 }, rows: 1 }
}

/** The output shape the guest fixture writes, built here for literal `JobResult`s. */
function partitionOutput(index: number): CanonicalValue {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, index, true)
  return { p: bytes }
}

/** One shard that agreed, carrying the map receipt given. */
function agreedShard(
  partitionIndex: number,
  output: CanonicalValue,
  attestation: ShardResult['attestation'],
): ShardResult {
  return {
    partitionIndex,
    inputCid: FIXED_CID,
    degraded: false,
    rejections: [],
    attempted: [`n${String(partitionIndex)}`],
    generations: 1,
    ending: 'agreed',
    speculated: false,
  judgedAt: null,
    disagreed: false,
    copies: [],
    attestation,
    // A sovereign shard is never handed to `composeQuorum` — it has one operator by
    // construction. `not-attempted` is what `submitJob` really reports for one.
    quorum: { kind: 'not-attempted', reason: 'a sovereign shard is not composed into a quorum' },
    verification: {
      status: 'agreed',
      resultCid: FIXED_CID,
      output,
      agreeing: [{ nodeId: `n${String(partitionIndex)}`, attestation: 'signed-by-nobody' }],
      replicas: 1,
      failures: [],
      grossFuel: 0,
      usefulFuel: 0,
    },
  }
}

/** One shard that never reached agreement — an owner that contributed nothing. */
function insufficientShard(partitionIndex: number): ShardResult {
  return {
    partitionIndex,
    inputCid: FIXED_CID,
    degraded: true,
    rejections: [],
    attempted: [],
    generations: 0,
    ending: 'never-placed',
    speculated: false,
  judgedAt: null,
    disagreed: false,
    copies: [],
    attestation: {
      kind: 'holds-no-verified-attestation',
      reason: 'this shard is insufficient rather than agreed',
      agreeing: 0,
      verified: 0,
    },
    quorum: { kind: 'not-attempted', reason: 'a sovereign shard is not composed into a quorum' },
    verification: {
      status: 'insufficient',
      reason: 'no node of this owner was live',
      failures: [],
    },
  }
}

function jobWith(shards: readonly ShardResult[]): JobResult {
  return {
    moduleCid: FIXED_CID,
    shards,
    complete: shards.every((s) => s.verification.status === 'agreed'),
    attestation: {
      kind: 'holds-no-verified-attestation',
      reason: 'the job-level receipt is not this arm’s subject; the per-shard ones are',
      agreeing: shards.length,
      verified: 0,
    },
    grossFuel: 0,
    usefulFuel: 0,
    verificationMultiplier: 1,
    redispatches: 0,
    leaseHistory: [],
    speculationMultiplier: 1,
    speculationSpent: 0,
    // These literals stand for a job whose owners are named by the SPEC beside them, and
    // `submitJob`'s own coverage is not what this arm reads — it derives its own over the
    // partials it admitted, which is a strictly later question. Stated as the named arm so
    // nothing here can be mistaken for the reading under test.
    coverage: 'defines-no-owners',
  }
}

/** A spec that pins one shard per owner, in the order given. */
function specPinnedTo(owners: readonly OwnerId[]): JobSpec {
  return {
    moduleCid: FIXED_CID,
    shards: owners.map((ownerId) => ({ value: { row: ownerId }, label: 'sovereign' as const, ownerId })),
    executors: [],
    nodes: [],
    redundancy: 1,
    onQuorumShortfall: 'runs-at-available-redundancy',
  }
}

/** A clean manifest: `n` rows watched, nothing refused. */
function manifestWatching(registeredSovereign: number, over: Partial<EgressManifest> = {}): EgressManifest {
  return {
    nodeId: 'requestor',
    ownerId: 'requestor-owner',
    entries: [{ to: 'n0', bytes: 128 }],
    totalBytes: 128,
    violations: [],
    registeredSovereign,
    ...over,
  }
}

/** A requestor that serves its own blocks, plus N production combine agents. */
async function combineFabric(count: number) {
  const network = new MemoryNetwork()
  const requestorStore = new MemoryBlockstore()
  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
  serveAgent({
    ...SENTINELS,
    rpc: requestorRpc,
    executor: new WasmExecutor({ nodeId: 'requestor', blockstore: requestorStore }),
    blockstore: requestorStore,
  })

  const endpoints: RpcEndpoint[] = [requestorRpc]
  const ids: string[] = []
  for (let index = 0; index < count; index++) {
    const id = `c${String(index)}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
    // The requestor is where the leaves live — the topology every fabric here has.
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['requestor']),
    )
    serveAgent({
      ...SENTINELS,
      rpc,
      executor: new WasmExecutor({ nodeId: id, blockstore: store }),
      blockstore: store,
    })
    endpoints.push(rpc)
    ids.push(id)
  }
  return {
    requestorRpc,
    requestorStore,
    ids,
    close: (): void => {
      for (const rpc of endpoints) rpc.close()
    },
  }
}

/**
 * Everything a passing call needs, so each refusal case varies exactly one thing.
 *
 * Two owners, both attested by their own certificate, one clean manifest watching two
 * rows, and two combine executors — the smallest arrangement in which an aggregation
 * exists at all and is performed twice.
 */
async function passingCall() {
  const fabric = await combineFabric(2)
  const job = jobWith([
    agreedShard(0, partitionOutput(0), receiptOver([ALICE.certificate])),
    agreedShard(1, partitionOutput(1), receiptOver([BOB.certificate])),
  ])
  const spec = specPinnedTo([ALICE.ownerId, BOB.ownerId])
  const options = {
    rpc: fabric.requestorRpc,
    executors: fabric.ids,
    blockstore: fabric.requestorStore,
    project,
    trustedIssuers: 'checks-no-combine-signatures' as const,
    egress: [manifestWatching(2)],
    // Two, which is the minimum, and stated rather than defaulted so a case that lowers
    // it below is visibly varying this and nothing else.
    redundancy: 2,
    // A fanout of 2 over two leaves is one combine — the whole tree, which is what makes
    // `minReplicas` a reading about every step rather than about the shallow half of one.
    fanout: 2,
  }
  return { fabric, job, spec, options }
}

describe('MR-02 — a sovereign aggregation admits an owner’s partial, or names why it will not', () => {
  it('aggregates two owners’ partials, keys each leaf on the owner, and reports complete coverage', async () => {
    const { fabric, job, spec, options } = await passingCall()
    try {
      const result = await reduceSovereignJob(job, spec, options)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const { value, coverage } = result.aggregate

      // The aggregation ran and every combine agreed.
      expect(value.outcome.ok).toBe(true)
      expect(value.outcome.rootCid).not.toBeNull()
      expect(value.tree.nodes).toHaveLength(1)
      // **The verification claim, read as a number.** Two independent executors performed
      // the one combine and produced the same CID; `executeReduce` reports a disagreement
      // rather than voting, so an empty `disagreements` beside `minReplicas: 2` is what
      // "the aggregation over contributions is verified" means here.
      expect(value.outcome.minReplicas).toBe(MIN_SOVEREIGN_COMBINE_REPLICAS)
      expect(value.outcome.disagreements).toEqual([])

      // **The leaf key is the owner**, which is the whole of MR-02's attribution half and
      // is what a partition-indexed reduce could not express. Read off the derived tree
      // rather than off the contribution list, so it is the topology that carries it.
      expect(value.tree.leaves.map((leaf) => leaf.id.split('\u0000')[0]).toSorted()).toStrictEqual(
        [ALICE.ownerId, BOB.ownerId].toSorted(),
      )
      expect(value.contributions.map((c) => c.ownerId)).toStrictEqual([ALICE.ownerId, BOB.ownerId])
      expect(value.contributions.map((c) => c.operators)).toStrictEqual([['alice-op'], ['bob-op']])

      // Coverage, derived and never declared.
      expect(coverage.complete).toBe(true)
      expect(coverage.covered).toBe(2)
      expect(coverage.total).toBe(2)
      expect(coverage.missing).toEqual([])
      expect(coverage.unexpected).toEqual([])

      // EGR-01's figure, carried rather than recomputed: two rows were watched and
      // nothing left carrying one. `violations: []` on its own could not say that.
      expect(value.egress).toStrictEqual({
        manifests: 1,
        registeredSovereign: 2,
        pinnedShards: 2,
        totalBytes: 128,
      })

      // The aggregation's receipt is the named absence here and that is truthful rather
      // than a shortfall: this fixture pins no combine issuer, so no combine statement was
      // checked. It is asserted so nothing can read the map's `owner-attested` half as
      // though it covered the aggregation.
      expect(value.aggregateAttestation).toHaveProperty(
        'kind',
        'holds-no-verified-aggregate-attestation',
      )
    } finally {
      fabric.close()
    }
  })

  /**
   * **What this arm requires is two CONTRIBUTIONS, not two OWNERS** — and until this case
   * existed, nothing here could tell those apart.
   *
   * Every other passing fixture pins one shard per owner, so "two owners" and "two
   * contributions" move together in all of them, and the refusal case that reads
   * *"a single contribution is promoted rather than combined"* varies **both** at once:
   * it passes `specPinnedTo([ALICE.ownerId])`, which is one owner **and** one shard. A
   * reader checking whether the arm needs a second owner would find every fixture
   * consistent with "yes" and none of them testing it.
   *
   * It cost a wrong verdict. `reachability-dispositions.ts` recorded this symbol as
   * blocked because *"the arm needs a job whose shards are pinned to two or more owners,
   * and no rig in this repository stands up two owners"*, and concluded that wiring it
   * was **an owner decision rather than a wiring fix**. The premise is false, as this
   * case measures: one owner's two distinct partials aggregate, and report complete
   * coverage over the one owner they came from.
   *
   * The three refusals that actually stand between a job and an aggregate are counted
   * over different things, which is why the conflation survived: `pinned.size === 0` is
   * over owner-pinned **shards**, `tree.nodes.length === 0` is over **contributions**,
   * and `minReplicas < 2` is over **combine executors**. None is over distinct owners.
   */
  it('aggregates ONE owner’s two distinct partials — the arm needs two contributions, not two owners', async () => {
    const { fabric, options } = await passingCall()
    try {
      const result = await reduceSovereignJob(
        // Two shards, one owner, and two DIFFERENT outputs — so the projection addresses
        // them apart and they key two leaves. The same-output pair is a separate case
        // above and refuses, which is what makes "distinct" the load-bearing word here
        // rather than "two".
        jobWith([
          agreedShard(0, partitionOutput(0), receiptOver([ALICE.certificate])),
          agreedShard(1, partitionOutput(1), receiptOver([ALICE.certificate])),
        ]),
        specPinnedTo([ALICE.ownerId, ALICE.ownerId]),
        { ...options, egress: [manifestWatching(2)] },
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const { value, coverage } = result.aggregate

      // The aggregation ran, and it ran at the redundancy the claim is carried at. This
      // is the whole finding: a single-owner job reaches a verified aggregate.
      expect(value.outcome.ok).toBe(true)
      expect(value.tree.nodes).toHaveLength(1)
      expect(value.outcome.minReplicas).toBe(MIN_SOVEREIGN_COMBINE_REPLICAS)
      expect(value.outcome.disagreements).toEqual([])

      // Both leaves key on the one owner, and there are two of them — which is what
      // distinguishes this from the promoted-single-contribution refusal. A tree keyed
      // on (contributor, cid) can hold two leaves for one contributor.
      expect(value.tree.leaves).toHaveLength(2)
      expect(new Set(value.tree.leaves.map((leaf) => leaf.id.split('\u0000')[0]))).toStrictEqual(
        new Set([ALICE.ownerId]),
      )
      expect(value.contributions.map((c) => c.ownerId)).toStrictEqual([ALICE.ownerId, ALICE.ownerId])

      // Coverage is over DISTINCT owners, so one owner contributing twice is 1/1 and
      // complete — not 2/2, and not partial. Asserted because it is the reading a caller
      // would use to decide the aggregate is trustworthy, and an off-by-one here would
      // make a complete single-owner job look like it had lost a contributor.
      expect(coverage.total).toBe(1)
      expect(coverage.covered).toBe(1)
      expect(coverage.complete).toBe(true)
      expect(coverage.missing).toEqual([])
      expect(coverage.unexpected).toEqual([])

      // Two rows pinned and two watched, so the egress reading is over the shards rather
      // than over the owners — the same distinction, in the half that carries the
      // sovereignty claim.
      expect(value.egress.pinnedShards).toBe(2)
      expect(value.egress.registeredSovereign).toBe(2)
    } finally {
      fabric.close()
    }
  })

  /**
   * An owner whose shard did not agree is a hole in the dataset, not a refusal.
   *
   * This is the one case where the arm is *supposed* to keep going, and it is the reason
   * `CoveredAggregate` exists: the number is real and it is over two owners out of three.
   */
  it('reports an owner that contributed nothing as missing coverage rather than refusing', async () => {
    const fabric = await combineFabric(2)
    try {
      const job = jobWith([
        agreedShard(0, partitionOutput(0), receiptOver([ALICE.certificate])),
        agreedShard(1, partitionOutput(1), receiptOver([BOB.certificate])),
        insufficientShard(2),
      ])
      const spec = specPinnedTo([ALICE.ownerId, BOB.ownerId, MALLORY.ownerId])
      const result = await reduceSovereignJob(job, spec, {
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        trustedIssuers: 'checks-no-combine-signatures',
        egress: [manifestWatching(3)],
        redundancy: 2,
        fanout: 2,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.aggregate.value.contributions).toHaveLength(2)
      expect(result.aggregate.coverage.complete).toBe(false)
      expect(result.aggregate.coverage.covered).toBe(2)
      expect(result.aggregate.coverage.total).toBe(3)
      expect(result.aggregate.coverage.missing).toStrictEqual([MALLORY.ownerId])
    } finally {
      fabric.close()
    }
  })
})

/**
 * Every refusal, each varying exactly one thing against {@link passingCall}.
 *
 * A table rather than eleven blocks, for the reason `owner-domain-agents.node.test.ts`
 * gives about its two arms: with every other argument coming from one builder there is no
 * second place a difference can hide, so each reason below is demonstrably produced by the
 * branch it names and not by a differently-broken fixture.
 */
describe('MR-02 — every refusal branch is reachable, and each names its own cause', () => {
  interface Case {
    readonly name: string
    /** The substring the refusal must carry. Distinct across the table by construction. */
    readonly says: string
    readonly vary: (base: Awaited<ReturnType<typeof passingCall>>) => {
      readonly job?: JobResult
      readonly spec?: JobSpec
      readonly options?: Partial<Omit<Awaited<ReturnType<typeof passingCall>>['options'], 'egress'>> & {
        readonly egress?: SovereignEgressEvidence
      }
    }
  }

  const cases: readonly Case[] = [
    {
      name: 'redundancy below the minimum — the caller asked for an unverified aggregation',
      says: 'one executor verifies nothing',
      vary: () => ({ options: { redundancy: 1 } }),
    },
    {
      name: 'a job that pins no shard to an owner — Phase 16’s reading, refused by name',
      says: 'pins no shard to an owner',
      vary: ({ job }) => ({
        spec: {
          ...specPinnedTo([]),
          shards: job.shards.map(() => ({ value: { a: 1 }, label: 'public' as const })),
        },
      }),
    },
    {
      name: 'the named absence of an egress manifest',
      says: 'holds no egress manifest',
      vary: () => ({ options: { egress: 'holds-no-egress-manifest' as const } }),
    },
    {
      name: 'an empty manifest list, which is not a manifest',
      says: 'an empty manifest list is not a manifest',
      vary: () => ({ options: { egress: [] } }),
    },
    {
      name: 'a manifest that recorded a refused frame carrying a registered row',
      says: 'the bytes stayed home but the aggregate would be reporting a run whose map tried to move data',
      vary: () => ({
        options: {
          egress: [
            manifestWatching(2, {
              violations: ['bafyrow'],
              entries: [{ to: 'n0', bytes: 4096, violation: 'bafyrow' }],
              totalBytes: 0,
            }),
          ],
        },
      }),
    },
    {
      name: 'a guard that watched fewer rows than the job pinned',
      says: 'a guard that was never given the rows cannot report that none of them left',
      vary: () => ({ options: { egress: [manifestWatching(1)] } }),
    },
    {
      name: 'an agreed sovereign shard whose map nobody attested',
      says: 'carries no verified attestation',
      vary: ({ job }) => ({
        job: jobWith([
          agreedShard(0, partitionOutput(0), {
            kind: 'holds-no-verified-attestation',
            reason: 'this node holds no certificate',
            agreeing: 1,
            verified: 0,
          }),
          job.shards[1] as ShardResult,
        ]),
      }),
    },
    {
      name: 'a partial attested under a user key that is not the owner it was pinned to',
      says: 'which do not include that owner',
      vary: ({ job }) => ({
        job: jobWith([
          agreedShard(0, partitionOutput(0), receiptOver([MALLORY.certificate])),
          job.shards[1] as ShardResult,
        ]),
      }),
    },
    {
      name: 'a partial attested by the owner AND by somebody else',
      says: 'a partial the owner did not solely produce is not owner-attested',
      vary: ({ job }) => ({
        job: jobWith([
          agreedShard(0, partitionOutput(0), receiptOver([ALICE.certificate, MALLORY.certificate])),
          job.shards[1] as ShardResult,
        ]),
      }),
    },
    {
      name: 'a public shard smuggled into a job this arm was asked to aggregate',
      says: 'would compute one number and report coverage for another',
      vary: ({ spec }) => ({
        spec: {
          ...spec,
          shards: [spec.shards[0] as JobSpec['shards'][number], { value: { a: 1 }, label: 'public' as const }],
        },
      }),
    },
    {
      name: 'one owner’s two partials that address alike, which would merge into one leaf',
      says: 'count that owner’s data once instead of twice',
      vary: () => ({
        // The same output twice under one owner: the projection is a pure function of the
        // output, so both partials address identically and the tree would key them on one
        // leaf. Three shards so a tree still forms after the collision would have shrunk it.
        job: jobWith([
          agreedShard(0, partitionOutput(7), receiptOver([ALICE.certificate])),
          agreedShard(1, partitionOutput(7), receiptOver([ALICE.certificate])),
          agreedShard(2, partitionOutput(2), receiptOver([BOB.certificate])),
        ]),
        spec: specPinnedTo([ALICE.ownerId, ALICE.ownerId, BOB.ownerId]),
        options: { egress: [manifestWatching(3)] },
      }),
    },
    {
      name: 'a single contribution, which is promoted rather than combined',
      says: 'merged nothing',
      vary: ({ job }) => ({
        job: jobWith([job.shards[0] as ShardResult]),
        spec: specPinnedTo([ALICE.ownerId]),
        options: { egress: [manifestWatching(1)] },
      }),
    },
    {
      name: 'a tree whose weakest combine found only one executor',
      says: 'below the 2 a sovereign aggregation is verified at',
      // One combine executor, so the walk collects one replica however many are wanted.
      // The redundancy option is unchanged, which is what makes this a reading about what
      // the fabric achieved rather than about what the caller asked for.
      vary: ({ fabric }) => ({ options: { executors: [fabric.ids[0] as string] } }),
    },
    {
      name: 'no executor at all — reduceJob’s own refusal, carried through rather than reworded',
      says: 'no executor to combine on',
      vary: () => ({ options: { executors: [] } }),
    },
    {
      name: 'no owner-pinned shard agreed',
      says: 'none produced an output to summarise',
      vary: () => ({
        job: jobWith([insufficientShard(0), insufficientShard(1)]),
      }),
    },
  ]

  for (const { name, says, vary } of cases) {
    it(`refuses: ${name}`, async () => {
      const base = await passingCall()
      try {
        const varied = vary(base)
        const result = await reduceSovereignJob(varied.job ?? base.job, varied.spec ?? base.spec, {
          ...base.options,
          ...varied.options,
        })
        expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false)
        if (result.ok) return
        expect(result.reason).toContain(says)
      } finally {
        base.fabric.close()
      }
    })
  }

  /**
   * The anti-vacuity control, and it is the reason the table above is evidence.
   *
   * Every case asserts `ok === false`, which a `reduceSovereignJob` that refused
   * *everything* would satisfy fifteen times over — the exact shape of the check `VER-02`'s
   * predecessor was deleted for, one polarity inverted. So the unvaried call is asserted to
   * pass **here**, in this describe block, against the same builder the cases vary.
   */
  it('passes on the unvaried call, so the fifteen refusals above are about what they varied', async () => {
    const base = await passingCall()
    try {
      const result = await reduceSovereignJob(base.job, base.spec, base.options)
      expect(result.ok, `the unvaried call must pass: ${JSON.stringify(result)}`).toBe(true)
    } finally {
      base.fabric.close()
    }
  })

  /**
   * Every reason is distinct, so a case that started matching a different branch reddens.
   *
   * Without this, a refusal moved earlier in the function — the egress checks sit before
   * the attestation ones, and both before the reduce — could make several cases pass on one
   * branch while their names went on claiming otherwise.
   */
  it('produces a distinct reason per case, so no two cases are reading one branch', async () => {
    const reasons: string[] = []
    for (const { vary } of cases) {
      const base = await passingCall()
      try {
        const varied = vary(base)
        const result = await reduceSovereignJob(varied.job ?? base.job, varied.spec ?? base.spec, {
          ...base.options,
          ...varied.options,
        })
        if (!result.ok) reasons.push(result.reason)
      } finally {
        base.fabric.close()
      }
    }
    expect(reasons).toHaveLength(cases.length)
    expect(new Set(reasons).size).toBe(cases.length)
  })
})

/**
 * The end-to-end half: a real `submitJob` over a `MemoryNetwork`, then the sovereign arm.
 *
 * The literals above are exhaustive over the named refusals and a fabric would add nothing
 * to any of them. This case exists for the one property a literal cannot carry: that the
 * receipt the arm reads is one `submitJob` **built**, from a signature a real executor
 * produced over a real task, rather than one this file wrote down.
 */
describe('MR-02 — the arm reads a receipt submitJob built, not one the fixture wrote', () => {
  it('admits two owners’ partials off receipts derived from real signed executions', async () => {
    const network = new MemoryNetwork()
    const endpoints: RpcEndpoint[] = []
    try {
      const requestorStore = new MemoryBlockstore()
      const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
      endpoints.push(requestorRpc)
      serveAgent({
        ...SENTINELS,
        rpc: requestorRpc,
        executor: new WasmExecutor({ nodeId: 'requestor', blockstore: requestorStore }),
        blockstore: requestorStore,
      })
      await requestorStore.put(MODULE_WRITES_PARTITION)

      // One node per owner, each signing with its own certificate. The signer is what
      // makes `ShardResult.attestation` a receipt rather than the named absence, and the
      // certificate's `userKey` is what the arm compares the shard's pinned owner against.
      const owners = [ALICE, BOB]
      const signers: ResultSigner[] = [
        { nodeSeed: new Uint8Array(32).fill(0xd2), certificate: ALICE.certificate },
        { nodeSeed: new Uint8Array(32).fill(0xd4), certificate: BOB.certificate },
      ]
      const executorIds: string[] = []
      for (const [index, signer] of signers.entries()) {
        const id = `owner${String(index)}`
        const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
        endpoints.push(rpc)
        const store = new FetchingBlockstore(
          new MemoryBlockstore(),
          new RpcBlockSource(rpc, () => ['requestor']),
        )
        serveAgent({
          ...SENTINELS,
          rpc,
          // `attestResults` around the executor is what signs an **exec** result;
          // `serveAgent`'s own `attest` signs a **combine**. Both factories compose the
          // first, and it is the first this case is about — the receipt on a shard.
          executor: attestResults(new WasmExecutor({ nodeId: id, blockstore: store }), signer),
          blockstore: store,
          attest: signer,
        })
        executorIds.push(id)
      }

      const { RemoteExecutor } = await import('./remote-executor.ts')
      const executors = executorIds.map(
        (id) => new RemoteExecutor(id, requestorRpc, 'dispatches-unauthenticated'),
      )
      const spec: JobSpec = {
        moduleCid: (await requestorStore.put(MODULE_WRITES_PARTITION)) as CID,
        shards: owners.map((owner) => ({
          value: { row: owner.ownerId },
          label: 'sovereign' as const,
          ownerId: owner.ownerId,
        })),
        executors,
        // `ownerId` is `certificate.userKey`, exactly as `discoverCandidates` builds it —
        // which is what makes the arm's comparison a check between two derivations rather
        // than a comparison of one string with itself.
        nodes: owners.map((owner, index) => ({
          nodeId: executorIds[index] as string,
          ownerId: owner.ownerId,
          canExecuteSovereign: true,
          load: 0,
          certificate: owner.certificate,
        })),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      }
      // No issuer set: `receiptFor` pins each replica against *that descriptor's own
      // issuer*, which is why `submitJob` takes none — see `reduce-job.ts`'s note on why
      // the reduce half has to take one and the map half must not.
      const submitted = await submitJob(spec, requestorStore, { checkpoints: 'checkpoints-nothing' })
      expect(submitted.ok).toBe(true)
      if (!submitted.ok) return
      expect(submitted.job.shards.every((s) => s.verification.status === 'agreed')).toBe(true)
      // The premise, asserted rather than assumed: these receipts are real, and each names
      // exactly its own owner. A fixture whose signing had quietly stopped would take the
      // arm to the named-absence refusal and look like a different failure.
      for (const [index, shard] of submitted.job.shards.entries()) {
        expect('kind' in shard.attestation, JSON.stringify(shard.attestation)).toBe(false)
        if ('kind' in shard.attestation) return
        expect(shard.attestation.userKeys).toStrictEqual([owners[index]?.ownerId])
      }

      const result = await reduceSovereignJob(submitted.job, spec, {
        rpc: requestorRpc,
        executors: executorIds,
        blockstore: requestorStore,
        project,
        trustedIssuers: 'checks-no-combine-signatures',
        egress: [manifestWatching(2)],
        redundancy: 2,
        fanout: 2,
      })
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) return
      expect(result.aggregate.coverage.complete).toBe(true)
      expect(result.aggregate.value.outcome.minReplicas).toBe(2)
      expect(result.aggregate.value.contributions.map((c) => c.ownerId).toSorted()).toStrictEqual(
        [ALICE.ownerId, BOB.ownerId].toSorted(),
      )
    } finally {
      for (const rpc of endpoints) rpc.close()
    }
  })
})

/**
 * MR-02 / VER-08 — the sovereign arm refuses the local combine the owner's placement
 * ruling prefers everywhere else, and the reason is verification rather than sovereignty.
 *
 * **The reading this case pins, because the plausible one is wrong.** A local combine here
 * would move *nothing*: `reduceJob` projects every partial into the requestor's own
 * blockstore before any combine is placed, so by the time a combine runs the requestor
 * already holds all of them — and the raw rows they summarise never left their owner at
 * all. Sovereignty is untouched either way, and a refusal justified on sovereignty grounds
 * would be this repository's recurring error of restating a real constraint about one
 * thing as a constraint about another.
 *
 * What a local combine would empty is the **verification** half. `PROJECT.md` splits the
 * claim as *the owner's contribution is trusted; the aggregation over contributions is
 * verified*, and the aggregation is the only half redundancy can carry — pinning removes
 * the second independent executor from the map by construction.
 * {@link MIN_SOVEREIGN_COMBINE_REPLICAS} is that claim in code, and a requestor combining
 * for itself contributes a replica that is not independent of the party reading the
 * answer, signed by nobody on purpose.
 */
describe('MR-02 — a sovereign aggregation is never combined by the requestor itself', () => {
  it('keeps every combine on a peer and says so in the outcome, not merely in the count', async () => {
    const { fabric, job, spec, options } = await passingCall()
    try {
      const result = await reduceSovereignJob(job, spec, options)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const { value } = result.aggregate

      // Not one combine was taken locally, and the outcome says it in the field that
      // carries the fact rather than leaving it to be inferred from `minReplicas`.
      expect(value.outcome.locallyCombined).toEqual([])
      // Every producer is a peer id from the fabric, and `the-requestor-itself` is not
      // among them — asserted by membership rather than by absence of one string, so a
      // rename of the constant could not make this pass vacuously.
      for (const executor of value.outcome.executedBy.values()) {
        expect(fabric.ids).toContain(executor)
      }

      // The refusal is stated per combine and names the caller's own requirement, which
      // is what distinguishes *this arm required remote* from *the local node was full*.
      expect(value.outcome.localRefusals).toHaveLength(value.tree.nodes.length)
      for (const entry of value.outcome.localRefusals) {
        expect(entry.reason).toContain('requires remote combining')
      }

      // And the claim the refusal exists to protect still holds: every combine reached
      // the minimum this arm is verified at.
      expect(value.outcome.minReplicas).toBeGreaterThanOrEqual(MIN_SOVEREIGN_COMBINE_REPLICAS)
    } finally {
      fabric.close()
    }
  })
})
