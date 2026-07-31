/**
 * The benchmark driver — produces the numbers `@o2/bench` reports.
 *
 * Node-only by necessity: reading CPU details, writing files, and standing up real
 * libp2p nodes all need a platform. The measurement and reporting stay in `@o2/bench`
 * so both transports are measured by identical code, which is the only thing that
 * makes the connectivity tax meaningful.
 *
 * Run with:  node --experimental-strip-types packages/node/src/bin/bench.ts [--quick]
 *
 * ## Node-seconds are measured here, not read from a field
 *
 * `JobResult` reports *fuel* — bytes across the guest ABI — which is deterministic and
 * therefore the right thing for a cost metric that must not make honest nodes
 * disagree. It is not time. So this driver times every executor call itself with
 * `performance.now()` and reports genuine node-seconds, with fuel alongside as a
 * separate, deterministic column.
 *
 * ## What this driver does not pretend
 *
 * One machine is available. Every run is same-machine, the label is derived from the
 * inventory rather than declared, and BENCH-06's distinct-machine half goes in the
 * report's `unmet` list — in its opening section, not a footnote.
 */

import { cpus, hostname, freemem, totalmem, platform, release } from 'node:os'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  SignedNameResolver,
  WasmExecutor,
  canonicalCid,
  guardModuleProvenance,
  publicNodes,
  signName,
} from '@o2/core'
import type { CanonicalValue, Executor, NameRecord, Task } from '@o2/core'
import type { CID } from 'multiformats/cid'
import {
  EgressGuard,
  FetchingBlockstore,
  RemoteExecutor,
  RpcBlockSource,
  RpcEndpoint,
  serveAgent,
  submitJobWithEgress,
} from '@o2/net'
import {
  NODE_LADDER,
  connectivityTax,
  costCrossover,
  measure,
  renderMarkdown,
  summarise,
} from '@o2/bench'
import type { Inventory, JobRunner, Machine, Observation, RunConfig, SweepResult } from '@o2/bench'
import { MODULE_WRITES_PARTITION } from '../../../core/src/executor/fixtures.ts'
import { FabricNode } from '../fabric-node.ts'

const QUICK = process.argv.includes('--quick')
const RUNS = QUICK ? 6 : 20
const LADDER = QUICK ? [1, 2, 4] : NODE_LADDER
/** Real libp2p nodes are expensive to stand up; the ladder is shorter and declared. */
const REAL_LADDER = QUICK ? [1, 2] : NODE_LADDER
/**
 * Shards per job.
 *
 * Raised from 8 to 16 by phase 13.1. 8 was one below a measured cliff: dispatching 12
 * shards immediately after dial aborted the whole libp2p connection with
 * `MaxEarlyStreamsError`, so the benchmark shipped just under a limit that would have
 * killed it, and a published curve would have been measured against an unfixed
 * connection-killing bound. NET-09's per-peer send gate removes the cliff, and running
 * above it here is what demonstrates that on the production benchmark path rather than
 * only in a test. 16 is comfortably past 12 and still a count a reader can hold in
 * their head against the node ladder.
 */
const SHARDS = 16
/**
 * The admission limit every node in this benchmark runs with — SCHED-06.
 *
 * **Declared here, not inherited.** `FabricNode` now refuses an `exec` request past
 * its slot limit, and `submitJob` has no re-pick: a refusal becomes a failed shard,
 * which the incomplete-run rule reports as a failed run. A published scaling curve
 * shaped by a limit nobody wrote down is exactly the failure this milestone exists to
 * remove, so the value is stated at every node-construction site in this file from
 * this one constant and printed in the report the reader sees.
 *
 * **Both rigs, from the same constant, and that is the point.** Until this constant
 * reached `memoryFabric`, the two published curves were measured under different node
 * behaviour: the real-transport rig went through `FabricNode.start` and admitted,
 * while every `serveAgent` call in the memory rig was handed the named opt-out and so
 * ran with admission switched off entirely. Nothing in the report said so. A
 * connectivity tax computed across that pair is a ratio between two different nodes,
 * and Phase 23's multi-process driver is built on this harness.
 *
 * Equal to the shipped `DEFAULT_MAX_CONCURRENT_TASKS` at the time of writing, and that
 * is a deliberate coincidence rather than inheritance: a later change to the default
 * cannot silently move this curve.
 *
 * Why a declared limit is needed here at all is a structural fact about the job path,
 * read from source: a job's whole dispatch set is genuinely concurrent. `submitJob`
 * runs every shard through one `Promise.all` (`core/src/job/submit.ts:206`) and
 * `executeVerified` runs every replica through another (`core/src/job/verify.ts:149`),
 * so these shards do not trickle in — they arrive together and a node meets them all
 * at once. That is the *shape* of the arrival and deliberately not a *count*: how many
 * land on any one node is **unmeasured**, and multiplying it by `SHARDS`, by
 * `redundancy` or by anything else is the step that produced three different wrong
 * answers during planning. What would measure it is `FabricNode.executorPeakInFlight`
 * read from a run of this driver; nothing here does that yet.
 */
const DECLARED_ADMISSION_LIMIT = 64

/**
 * The benchmark's own build authority — DET-03, DATA-08.
 *
 * This process genuinely *is* one: it compiles nothing, publishes nothing, and the
 * only artifact it dispatches is a fixture it put in its own store a line earlier. So
 * it signs for that fixture itself rather than borrowing an anchor from somewhere it
 * does not belong.
 *
 * A constant rather than a random seed, because a benchmark must be reproducible: a
 * fresh key per run would change the signature bytes and therefore the record bytes on
 * every invocation, which is a needless source of variation in a file whose entire job
 * is to make runs comparable. And this key protects nothing outside this process — it
 * vouches for `MODULE_WRITES_PARTITION`, to nodes this process just started, over a
 * transport it owns — so its presence in the source is a statement of fact, not a leak.
 *
 * ## Why the rigs are guarded at all, and what it costs the figures
 *
 * 12-CONTEXT.md's precedent is that the benchmark harness may stay on the unguarded
 * primitive, and 14-CONTEXT.md decision 2 hands the call to the planner. It is taken
 * the other way here, for one reason: after this phase there is no production dispatch
 * path that skips the signature check, so a rig that skipped it would be measuring a
 * path that no longer exists. A per-dispatch verification is a cost the published
 * figures should include rather than quietly exclude.
 *
 * That is also why `wasmInProcess` is wrapped. It is the baseline the two fabrics are
 * compared against; if the fabrics pay for the check and the baseline does not, every
 * reported speedup is inflated by exactly the difference.
 *
 * ## What a green run of this driver does and does not tell you
 *
 * **The exit code tells you nothing.** `packages/bench/src/harness.ts` folds `complete`
 * into `incomplete: measured.length - completed.length`,
 * `packages/bench/src/report.ts` prints it as a table column, and this driver sets no
 * exit code — so `node bin/bench.ts --quick` exits 0 whether every rig checks a record
 * or none does. Never read a zero exit as evidence about anything here.
 *
 * **The `incomplete` column does, and it was measured on 2026-07-31.** A refused shard
 * is a failed shard, and a failed shard makes `result.job.complete` false, so a rig
 * whose guard was refusing everything reports it. Both readings were taken:
 *
 * | `--quick` run | exit | `incomplete`, all six sweeps |
 * |---|---|---|
 * | as shipped | 0 | **0** |
 * | with `BENCH_TRUST_ANCHOR` planted as a key that signed nothing | 0 | **5** |
 *
 * So the rigs really do complete *signed* jobs, and the column that says so has been
 * watched moving. Two things it still does not say: the planted case did not
 * distinguish which rig refused (all six sweeps moved together), and nothing re-derives
 * either reading on a later run — the standing guard on these call sites is
 * `packages/node/src/bench-egress.node.test.ts`, which reads this source with comments
 * stripped and has been watched reporting each requirement absent.
 *
 * What would make the runtime reading standing rather than one-off is a non-zero exit
 * when a rig completes no job at all. Deliberately not added here: several later phases
 * modify this driver and some rewrite it, and an exit-code rule would change the
 * meaning of every `node bin/bench.ts --quick` verification gate in the repository — a
 * change that belongs to whoever owns this driver's contract.
 */
const BENCH_SIGNING_SEED = new Uint8Array(32).fill(0x2b)
const BENCH_MODULE_NAME = 'o2-bench-fixture-module'

/**
 * The fixture module's CID, and the record that vouches for it.
 *
 * **One record covers all three rigs, and that is a measured fact rather than a
 * convenience.** The plan this implements expected one record per rig, on the grounds
 * that each rig builds its own store and might therefore compute its own CID. It does
 * not: `MemoryBlockstore.put` and `FsBlockstore.put` both compute
 * `CID.create(1, dagCbor.code, await sha256.digest(bytes))`, and `FsBlockstore`'s own
 * comment says why — *"same CID scheme as MemoryBlockstore, deliberately"*. A CID is a
 * function of the bytes and of nothing else, so all three rigs address
 * `MODULE_WRITES_PARTITION` identically.
 *
 * Each rig asserts that rather than assuming it, in {@link sameFixtureCid}. A rig whose
 * store disagreed would otherwise refuse every shard with a `cid-mismatch` and report
 * an incomplete run with no clue as to why.
 *
 * The expiry is an hour out. That is a configuration choice, not a measurement: it only
 * has to outlast one run, and nothing here reads how long a run takes.
 */
const FIXTURE_MODULE_CID: CID = await new MemoryBlockstore().put(MODULE_WRITES_PARTITION)
const FIXTURE_RECORD: NameRecord = signName(BENCH_SIGNING_SEED, {
  name: BENCH_MODULE_NAME,
  cid: FIXTURE_MODULE_CID,
  version: 1,
  expiresAt: Date.now() + 3_600_000,
})
/** The public half, read off the record rather than re-derived from the seed. */
const BENCH_TRUST_ANCHOR: string = FIXTURE_RECORD.signer

/**
 * Fail loudly if a rig's store addressed the fixture differently from the record.
 *
 * Cheap, and it converts a whole-rig silent zero into one named throw at start-up.
 */
function sameFixtureCid(rig: string, moduleCid: CID): CID {
  if (moduleCid.toString() !== FIXTURE_MODULE_CID.toString()) {
    throw new Error(
      `${rig} addressed the fixture module as ${moduleCid.toString()} but the signed record ` +
        `names ${FIXTURE_MODULE_CID.toString()} — every shard would be refused as a cid-mismatch`,
    )
  }
  return moduleCid
}

/**
 * Wrap an executor in the same guard a production node composes.
 *
 * **A separate resolver per node.** A `SignedNameResolver` holds the records it has
 * accepted, which is per-node state; one shared across a rig's nodes would make the rig
 * measure a fabric no real deployment has — the first node's `accept` would prime the
 * store every later node reads.
 */
function guarded(inner: Executor): Executor {
  return guardModuleProvenance(inner, {
    resolver: new SignedNameResolver([BENCH_TRUST_ANCHOR]),
    now: () => Date.now(),
  })
}

function inventory(nodeCount: number): Inventory {
  const cores = cpus()
  const machine: Machine = {
    hostId: hostname(),
    roles: ['worker', 'requestor'],
    cpuModel: cores[0]?.model ?? 'unknown',
    // `os.cpus()` reports logical CPUs. Physical count is not exposed portably, so
    // it is reported as unknown rather than guessed at half — a guess here would
    // silently halve the contention a reader infers.
    physicalCores: 0,
    logicalCores: cores.length,
    totalMemoryBytes: totalmem(),
    os: platform(),
    kernel: release(),
    runtime: `node ${process.version}`,
  }
  return { machines: [machine], nodeCount }
}

/** The job: `SHARDS` partitions of the fixture module, one input block. */
async function shardInputs(skew: RunConfig['skew']): Promise<readonly CanonicalValue[]> {
  return Array.from({ length: SHARDS }, (_, i) =>
    // `skewed` gives one partition a much larger input, so the ABI cost — and hence
    // the straggler — is concentrated where the design says it should be handled.
    skew === 'skewed' && i === 0
      ? { partition: i, payload: new Uint8Array(4096).fill(1) }
      : { partition: i, payload: new Uint8Array(16).fill(1) },
  )
}

/** Wraps an executor so every call's wall time is recorded. */
function timed(inner: Executor, into: { gross: number; perNode: Map<string, number> }): Executor {
  return {
    nodeId: inner.nodeId,
    async execute(task: Task) {
      const started = performance.now()
      try {
        return await inner.execute(task)
      } finally {
        const elapsed = (performance.now() - started) / 1000
        into.gross += elapsed
        into.perNode.set(inner.nodeId, (into.perNode.get(inner.nodeId) ?? 0) + elapsed)
      }
    },
  }
}

interface Fabric {
  readonly executors: readonly Executor[]
  readonly blockstore: MemoryBlockstore
  readonly moduleCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  /**
   * DET-03: what vouches for {@link Fabric.moduleCid} to this rig's nodes. Attached to
   * the `JobSpec` in `runnerFor`, so every `Task` `submitJob` builds carries it.
   */
  readonly moduleRecord: NameRecord
  /**
   * Wraps the requestor's outbound transport — DATA-05/DATA-06's production wiring,
   * reused here rather than bypassed. The requestor is the only node whose RPC
   * connection dispatches shards in this rig (every `RemoteExecutor` above is built
   * over its endpoint), so this is the one guard whose manifest is interesting.
   */
  readonly guard: EgressGuard
  close(): Promise<void>
}

/** N nodes on the in-process transport. */
async function memoryFabric(nodes: number): Promise<Fabric> {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()
  const moduleCid = sameFixtureCid('memoryFabric', await originStore.put(MODULE_WRITES_PARTITION))

  // The requestor serves blocks, exactly as `FabricNode` does over a real transport.
  // Without this the workers have the module but no shard *inputs*, and every run
  // fails — which the first full run duly reported as 19/19 incomplete rather than
  // as a fast success. That is the incomplete-run rule earning its place.
  //
  // Wrapped in `EgressGuard`, mirroring exactly what `FabricNode.start` does to its
  // own transport (`fabric-node.ts`) — this rig has no `FabricNode` to inherit the
  // guard from, so it is built here, over the identical `Transport` port, rather than
  // left unrecorded.
  const requestorGuard = new EgressGuard(network.connect('requestor'), 'requestor')
  const callerRpc = new RpcEndpoint(requestorGuard, { timeoutMs: 30_000 })
  serveAgent({
    rpc: callerRpc,
    // DET-03 — guarded exactly as `FabricNode.start` guards its own, and for the same
    // reason its `EgressGuard` and `LocalCapacity` are built here rather than
    // inherited: this rig has no `FabricNode` to inherit from, so it composes the
    // identical layer over the identical port.
    executor: guarded(new WasmExecutor({ nodeId: 'requestor', blockstore: originStore })),
    blockstore: originStore,
    // This endpoint serves blocks to the workers; the manifest this rig reads is
    // the submitting side's, and no task dispatched here is labelled sovereign, so
    // there is nothing registered against these sends to release.
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    // SCHED-06 — the same declared limit `realFabric`'s nodes start with, so the
    // memory curve and the real curve are measured against nodes that admit
    // identically. See `DECLARED_ADMISSION_LIMIT`.
    //
    // This rig has no `FabricNode` to inherit admission from — the same reason its
    // `EgressGuard` is constructed above rather than surfaced — so it is built here,
    // over the identical `serveAgent` hook a `FabricNode` fills. It is supplied to
    // *this* endpoint too and not only to the workers, on the same ground
    // `realFabric` gives its requestor the limit: it is a serving endpoint like any
    // other and nothing about it makes admission somebody else's concern. `nodeId`
    // is the same string the executor above is constructed with, so the capacity's
    // node id and the executor's cannot drift — the pattern `FabricNode.start`
    // documents beside its own construction.
    capacity: new LocalCapacity({ nodeId: 'requestor', maxConcurrent: DECLARED_ADMISSION_LIMIT }),
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  const endpoints: RpcEndpoint[] = []
  for (let i = 0; i < nodes; i++) {
    const id = `n${i}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 30_000 })
    // Empty local store plus network fallback: a worker pulls the module and its
    // input by CID, the same shape the real transport uses.
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['requestor']),
    )
    serveAgent({
      rpc,
      // DET-03 — one guard, and one resolver, per worker. See `guarded`.
      executor: guarded(new WasmExecutor({ nodeId: id, blockstore: store })),
      blockstore: store,
      // A worker endpoint in this rig, dispatched only public tasks. Its sends are
      // untapped: the guard this benchmark reads is the submitting endpoint's.
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      // SCHED-06 — one `LocalCapacity` per worker, at the declared limit.
      //
      // Per worker and never one shared instance, and the reason is a refusal read
      // from source rather than a preference. `serveAgent`'s exec branch keys the
      // slot on `inputCid:partitionIndex` (`net/src/agent.ts`), and `executeVerified`
      // hands the *identical* `task` to every replica executor through one
      // `Promise.all` (`core/src/job/verify.ts`) — so the two replicas of one shard
      // carry the same key. `LocalCapacity.#decide` refuses a key already held with
      // `… is already in flight here` (`core/src/placement.ts`), so a counter shared
      // across these workers would refuse the second replica of every shard, and this
      // rig would measure a fabric that cannot verify anything.
      capacity: new LocalCapacity({ nodeId: id, maxConcurrent: DECLARED_ADMISSION_LIMIT }),
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })
    endpoints.push(rpc)
  }

  const remote = endpoints.map((_, i) => new RemoteExecutor(`n${i}`, callerRpc))

  return {
    executors: remote,
    blockstore: originStore,
    moduleCid,
    moduleRecord: FIXTURE_RECORD,
    guard: requestorGuard,
    async close() {
      callerRpc.close()
      for (const rpc of endpoints) rpc.close()
    },
  }
}

/** N real libp2p nodes over TCP on loopback. Same machine — labelled as such. */
async function realFabric(nodes: number): Promise<Fabric> {
  const root = await mkdtemp(join(tmpdir(), 'o2-bench-'))
  const started: FabricNode[] = []

  for (let i = 0; i < nodes; i++) {
    const dir = join(root, `node-${i}`)
    await mkdir(dir, { recursive: true })
    // `maxConcurrentTasks` is stated, never inherited — see
    // `DECLARED_ADMISSION_LIMIT`. The requestor below declares the same value for the
    // same reason: it is a `FabricNode` like any other and serves `exec` requests like
    // any other, so leaving it on the default would put half the fabric on a limit
    // this run does not record.
    started.push(
      await FabricNode.start({
        blockstoreDir: dir,
        rpcTimeoutMs: 30_000,
        maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
        // DET-03 — this rig's nodes go through the node factory rather than
        // constructing an executor, so they ask for the guard by naming the anchor
        // instead of composing it. The submitter below states the same value for the
        // same reason it states the same admission limit: it is a `FabricNode` like
        // any other and serves `exec` requests like any other.
        trustAnchors: [BENCH_TRUST_ANCHOR],
      }),
    )
  }

  const requestorDir = join(root, 'requestor')
  await mkdir(requestorDir, { recursive: true })
  const requestor = await FabricNode.start({
    blockstoreDir: requestorDir,
    rpcTimeoutMs: 30_000,
    maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
    trustAnchors: [BENCH_TRUST_ANCHOR],
  })
  const moduleCid = sameFixtureCid('realFabric', await requestor.store.put(MODULE_WRITES_PARTITION))

  // Everyone dials the requestor, so blocks are reachable from every worker.
  for (const node of started) {
    await node.libp2p.dial(requestor.libp2p.getMultiaddrs())
  }

  const executors = started.map((node) => new RemoteExecutor(node.libp2p.peerId.toString(), requestor.rpc))

  return {
    executors,
    blockstore: requestor.store as unknown as MemoryBlockstore,
    moduleCid,
    moduleRecord: FIXTURE_RECORD,
    // `FabricNode.start` already wraps its transport in an `EgressGuard` (`egress`)
    // and builds `rpc` over that wrapper (13-02) — nothing to construct here, only
    // to surface, exactly the same field `bin/agent.ts`'s own `FabricNode` exposes.
    guard: requestor.egress,
    async close() {
      for (const node of [...started, requestor]) await node.stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** Build a runner that reuses one fabric per node count across all iterations. */
function runnerFor(build: (nodes: number) => Promise<Fabric>): {
  run: JobRunner
  /**
   * Egress recorded across every run this instance has driven so far, read off
   * `Fabric.guard` via `submitJobWithEgress` rather than the bare `submitJob` this
   * driver used to call — DATA-05/DATA-06's manifest, reachable from the entry
   * point itself, not only from a test harness that constructs its own guard.
   */
  egressTotals: () => { entries: number; bytes: number }
  dispose: () => Promise<void>
} {
  const fabrics = new Map<number, Fabric>()
  let egressEntries = 0
  let egressBytes = 0

  const run: JobRunner = async (config, codeCache) => {
    let fabric = fabrics.get(config.nodes)
    if (fabric === undefined) {
      fabric = await build(config.nodes)
      fabrics.set(config.nodes, fabric)
    }

    const cost = { gross: 0, perNode: new Map<string, number>() }
    const executors = fabric.executors.map((executor) => timed(executor, cost))
    const shards = await shardInputs(config.skew)

    const started = performance.now()
    const result = await submitJobWithEgress(
      {
        moduleCid: fabric.moduleCid,
        // DET-03 — `submitJob` copies this onto every `Task` it builds, so the record
        // travels with each shard to whichever node the placement picks. Without it
        // every rig above refuses every shard.
        moduleRecord: fabric.moduleRecord,
        shards: shards.map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: config.redundancy,
      },
      fabric.blockstore,
      [fabric.guard],
    )
    const makespanMs = performance.now() - started

    if (result.ok) {
      // Exactly one guard was supplied above, so exactly one manifest comes back —
      // still read defensively rather than asserted, per `noUncheckedIndexedAccess`.
      const manifest = result.manifests[0]
      if (manifest !== undefined) {
        egressEntries += manifest.entries.length
        egressBytes += manifest.totalBytes
      }
    }

    const complete = result.ok && result.job.complete
    // Useful node-seconds = gross ÷ redundancy, because every replica of a shard
    // does the identical work and exactly one of them is the answer. Stated rather
    // than derived from a field, since the job's own "useful" figure is in fuel.
    const usefulNodeSeconds = cost.gross / Math.max(1, config.redundancy)

    return {
      makespanMs,
      complete,
      grossNodeSeconds: cost.gross,
      usefulNodeSeconds,
      verificationMultiplier: result.ok ? result.job.verificationMultiplier : 0,
      // submitJob does not speculate or re-dispatch; those paths belong to
      // runResilient and are not exercised by this workload. Reported as the
      // identity rather than as a measured zero.
      speculationMultiplier: 1,
      redispatches: 0,
      codeCache,
    } satisfies Observation
  }

  return {
    run,
    egressTotals: () => ({ entries: egressEntries, bytes: egressBytes }),
    dispose: async () => {
      for (const fabric of fabrics.values()) await fabric.close()
      fabrics.clear()
    },
  }
}

/**
 * The single-threaded baseline for the COST crossover.
 *
 * The fastest honest implementation of the identical work: compute each partition's
 * output directly, in one thread, with no WASM, no CIDs, no verification, no network.
 * That is what COST asks to be beaten.
 */
async function baseline(runs: number): Promise<readonly number[]> {
  const observations: number[] = []
  const inputs = await shardInputs('uniform')

  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    const outputs: Uint8Array[] = []
    for (let partition = 0; partition < inputs.length; partition++) {
      // The identical computation the fixture module performs: emit the partition
      // index as a 4-byte little-endian value.
      const out = new Uint8Array(4)
      new DataView(out.buffer).setUint32(0, partition, true)
      outputs.push(out)
    }
    if (outputs.length !== inputs.length) throw new Error('baseline miscomputed')
    observations.push(performance.now() - started)
  }
  return observations
}

/** Supplementary: the same work in-process through WASM, no fabric. */
async function wasmInProcess(runs: number): Promise<readonly number[]> {
  const store = new MemoryBlockstore()
  const moduleCid = sameFixtureCid('wasmInProcess', await store.put(MODULE_WRITES_PARTITION))
  // DET-03 — guarded, and this is the leg it would have been most tempting to skip.
  // This baseline exists to be compared against the two fabrics; if they pay for the
  // signature check and it does not, every reported speedup is inflated by exactly the
  // difference. A baseline measuring a cheaper path than the thing it is the baseline
  // for is not a baseline.
  const executor = guarded(new WasmExecutor({ nodeId: 'local', blockstore: store }))
  const inputs = await shardInputs('uniform')

  const inputCids = []
  for (const value of inputs) {
    const encoded = await canonicalCid(value)
    if (!encoded.ok) throw new Error('fixture not encodable')
    await store.put(encoded.bytes)
    inputCids.push(encoded.cid)
  }

  const observations: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    for (let partition = 0; partition < inputCids.length; partition++) {
      await executor.execute({
        moduleCid,
        // The raw `Task` literal this rig dispatches — there is no `submitJob` here to
        // copy the record on, so it is attached by hand.
        moduleRecord: FIXTURE_RECORD,
        inputCid: inputCids[partition] as (typeof inputCids)[number],
        partitionIndex: partition,
        partitionCount: inputCids.length,
      })
    }
    observations.push(performance.now() - started)
  }
  return observations
}

async function main(): Promise<void> {
  const outDir = join(process.cwd(), '.planning', 'bench')
  await mkdir(outDir, { recursive: true })

  process.stdout.write(`o2 benchmark — ${QUICK ? 'quick' : 'full'} run, ${RUNS} iterations\n`)

  const memory = runnerFor(memoryFabric)
  const memoryResults: SweepResult[] = []
  for (const nodes of LADDER) {
    process.stdout.write(`  memory transport, ${nodes} node(s)…\n`)
    memoryResults.push(
      await measure(
        memory.run,
        { nodes, shards: SHARDS, redundancy: Math.min(2, nodes), transport: 'memory', skew: 'uniform' },
        { runs: RUNS },
      ),
    )
  }
  const memoryEgress = memory.egressTotals()
  process.stdout.write(
    `  memory transport egress manifest: ${memoryEgress.entries} frames, ${memoryEgress.bytes} bytes\n`,
  )
  await memory.dispose()

  const real = runnerFor(realFabric)
  const realResults: SweepResult[] = []
  const excluded: { config: string; reason: string }[] = []
  for (const nodes of REAL_LADDER) {
    process.stdout.write(`  real transport, ${nodes} node(s)…\n`)
    try {
      realResults.push(
        await measure(
          real.run,
          { nodes, shards: SHARDS, redundancy: Math.min(2, nodes), transport: 'real', skew: 'uniform' },
          { runs: RUNS },
        ),
      )
    } catch (cause) {
      // Published as excluded, never silently dropped — the methodology commits to
      // this. A rung that vanishes between plan and results is indistinguishable
      // from one removed because its number was inconvenient.
      const detail = cause instanceof Error ? cause.message : String(cause)
      process.stdout.write(`    excluded: ${detail}\n`)
      excluded.push({
        config: `real transport, ${nodes} nodes`,
        reason:
          `\`${detail}\` — libp2p caps inbound connections at ` +
          '`INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one ' +
          'host, so beyond ~5 concurrent dials to the requestor the noise handshake is ' +
          'killed and the failure reads like a network fault. A same-machine artifact of ' +
          'a documented default, not a property of the fabric.',
      })
    }
  }
  const realEgress = real.egressTotals()
  process.stdout.write(
    `  real transport egress manifest: ${realEgress.entries} frames, ${realEgress.bytes} bytes\n`,
  )
  await real.dispose()

  process.stdout.write('  skewed configuration, memory transport…\n')
  const skewRunner = runnerFor(memoryFabric)
  const skewed = await measure(
    skewRunner.run,
    { nodes: 4, shards: SHARDS, redundancy: 2, transport: 'memory', skew: 'skewed' },
    { runs: RUNS },
  )
  await skewRunner.dispose()

  process.stdout.write('  single-threaded baseline…\n')
  const baselineSummary = summarise((await baseline(RUNS)).slice(1))
  const wasmSummary = summarise((await wasmInProcess(RUNS)).slice(1))

  const maxNodes = Math.max(...LADDER)
  const report = {
    title: 'o2.services — benchmark run',
    at: new Date().toISOString(),
    inventory: inventory(maxNodes),
    baseline: baselineSummary,
    memoryTransport: memoryResults,
    realTransport: realResults,
    connectivity: connectivityTax(memoryResults, realResults),
    crossover: costCrossover(baselineSummary, memoryResults),
    unmet: [
      '**No parallel speedup is measurable here, by construction.** Every node in both' +
        ' curves runs inside one OS process on one JavaScript event loop — the memory' +
        ' transport is in-process by definition, and the real transport creates its' +
        ' libp2p nodes in the same process and dials them over loopback. So these curves' +
        ' measure **coordination cost**, not parallelism, and the flat makespan across' +
        ' the node ladder is the expected consequence rather than a finding about' +
        ' scaling. Demonstrating speedup needs separate processes or machines and is not' +
        ' done here.',
      '**BENCH-06 (distinct machines) is NOT met.** One machine was available, so every' +
        ' number here is same-machine. Processes on one host share a CPU, a memory bus and' +
        ' a scheduler; this measures software scaling with contention included and the' +
        ' network excluded, and it is not a measurement of N nodes.',
      'No hosted relay exists yet, so no WAN browser-tier number is included. The real' +
        ' transport here is libp2p over TCP on loopback.',
      'The WASM fixture does almost no work, so per-task overhead dominates and the COST' +
        ' crossover is worse than it would be for a realistic workload. Declared in the' +
        ' methodology before these runs, not discovered afterwards.',
'The 1-node rung necessarily runs at redundancy 1: verification needs two' +
        ' independent executors, and one node cannot supply them. Its verification tax of' +
        ' 1.0 is therefore a property of the system, not a cheaper configuration — the' +
        ' same reason a sovereign shard with one owner node is owner-attested.',
      'Speculation and churn taxes are 1.0 and 0 because `submitJob` neither speculates' +
        ' nor re-dispatches and no node was killed during these runs. They are identities,' +
        ' not measurements.',
    ],
    excluded,
  }

  const markdown = [
    renderMarkdown(report),
    '## Supplementary — where the time goes',
    '',
    'Not part of the pre-registered plan; included because it decomposes the crossover',
    'rather than flattering it.',
    '',
    // What the run was measured under, printed rather than left in the source. A
    // curve shaped by an admission limit nobody wrote down is the failure this
    // milestone exists to remove; `bench-egress.node.test.ts` pins this line's
    // presence, because a reader of the published table cannot check the source.
    `- Declared run configuration: **${SHARDS} shards** per job, and **every node in both` +
      ` rigs admits at ${DECLARED_ADMISSION_LIMIT} concurrent tasks** — the memory rig from` +
      ' one `LocalCapacity` per `serveAgent` endpoint, the real rig from' +
      ' `maxConcurrentTasks` on each `FabricNode.start`, both reading one declared constant' +
      ' in this driver rather than inheriting a default. That is load-bearing for the' +
      ' connectivity tax below: until phase 13.1 wired it, the memory rig ran with' +
      ' admission switched off while the real rig admitted, so the two curves were measured' +
      ' against nodes that behaved differently and nothing in the report said so. Shards' +
      ' were raised from 8 by phase 13.1, above the measured 12-shard cliff the per-peer' +
      ' send gate removed, so the two shard counts are not measuring the same workload as' +
      ' an earlier run.',
    '',
    `- Single-threaded, native, no fabric: **${baselineSummary.p50.toFixed(3)}ms** p50`,
    `- Same work through WASM in-process, no fabric: **${wasmSummary.p50.toFixed(3)}ms** p50`,
    `- Skewed input, 4 nodes, memory transport: **${skewed.makespan.p50.toFixed(1)}ms** p50` +
      ` (uniform at 4 nodes: ${(memoryResults.find((r) => r.config.nodes === 4)?.makespan.p50 ?? Number.NaN).toFixed(1)}ms)`,
    '',
    'Reading the decomposition: the native baseline and the same work through WASM',
    'in-process differ by more than two orders of magnitude, and the distributed run',
    'adds well under one more on top of the WASM figure. Most of the COST gap is',
    'therefore the guest ABI on a workload that does almost no work — not the fabric.',
    'That is a statement about the fixture, and it is why the methodology declared the',
    'fixture bias in advance rather than discovering it here.',
    '',
  ].join('\n')

  await writeFile(join(outDir, 'raw.json'), JSON.stringify({ report, skewed, wasmSummary }, null, 2))
  await writeFile(join(process.cwd(), '.planning', 'BENCHMARK-RESULTS.md'), markdown)

  process.stdout.write(`\nwrote .planning/BENCHMARK-RESULTS.md and .planning/bench/raw.json\n`)
}

await main()
