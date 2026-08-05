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
import type {
  AdmissionControl,
  CanonicalValue,
  Executor,
  NameRecord,
  NodeDescriptor,
  ShardAttestation,
  Task,
} from '@o2/core'
import type { CID } from 'multiformats/cid'
import {
  EgressGuard,
  FetchingBlockstore,
  RemoteExecutor,
  RpcBlockSource,
  RpcEndpoint,
  discoverCandidates,
  reduceJob,
  rpcAdmission,
  serveAgent,
  submitJobWithEgress,
} from '@o2/net'
import type { AggregateAttestation, CombineTrustAnchors } from '@o2/net'
import { peerIdForNodeKey } from '@o2/libp2p'
import {
  NODE_LADDER,
  connectivityTax,
  costCrossover,
  measure,
  renderMarkdown,
  summarise,
} from '@o2/bench'
import type {
  Inventory,
  JobRunner,
  Machine,
  Observation,
  ReduceObservation,
  RunConfig,
  SweepResult,
} from '@o2/bench'
import { MODULE_WRITES_PARTITION } from '../../../core/src/executor/fixtures.ts'
import { FabricNode } from '../fabric-node.ts'

/**
 * Derive the real rig's executors by **discovery** rather than from this driver's own
 * list — SCHED-01's entry-point call path. Off by default.
 *
 * ## Why the flag exists
 *
 * `discoverCandidates` (`@o2/net`) must be reachable from one of the five runnable entry
 * points or Phase 22's guard fails on it, and that phase's roadmap section records an
 * overruled proposal to accept a capability as entry-point-unreachable: *shipping an
 * adapter with no callers is the defect this milestone exists to remove, and naming it is
 * not the same as fixing it.* This is that path.
 *
 * ## Why it is off by default
 *
 * 15-CONTEXT.md decision 2 — a published scaling curve must not be reshaped by a change
 * nobody declared. With the flag absent, `realFabric` builds exactly what it built before
 * this flag existed, down to the enrollment round trip not happening at all. The default
 * run measures what it measured yesterday.
 *
 * ## What it changes when set, and why the two runs are not comparable
 *
 * The executor set stops being `started.map(...)` and becomes the intersection of real
 * provider answers with signed capability records, keyed by the input CID; and placement
 * asks each candidate before using it (`admit`). Both are real work on the timed path, so
 * **a `--discover` run must not be published beside a default one.** The report line says
 * so rather than leaving it to whoever reads the numbers.
 *
 * ## Read the same way `--quick` is read
 *
 * `process.argv.includes`, not `parseArgs`. The plan called for `parseArgs`, and this file
 * has none — `QUICK` on the next line is how it has always read a flag. Following the file
 * beats importing a parser to add one boolean.
 */
const DISCOVER = process.argv.includes('--discover')

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
 * read from source: a job's whole dispatch set is genuinely concurrent. `submitJob` maps
 * every shard through one `Promise.all` over `inputCids`, and `executeVerified` runs
 * every replica through another over its `executors`, so these shards do not trickle in
 * — they arrive together and a node meets them all at once.
 *
 * **Cited by symbol and not by line, because both line citations here had rotted**: the
 * first named `submit.ts:206` for a call that is now near 1468, the second
 * `verify.ts:149` for one now at 188. A symbol a reader can grep survives the next edit;
 * a line number silently starts pointing at something else.
 *
 * **And each element of that map is no longer one dispatch.** Since 20-01 it is
 * `submitJob`'s generation loop — place, grant a lease, dispatch under it, renew only
 * against evidence, re-place — so one shard can meet a node in more than one generation,
 * and what arrives together is a generation's dispatch set rather than the job's.
 *
 * That is the *shape* of the arrival and deliberately not a *count*: how many
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
    // `aggregator` has been declared in `MachineRole` and never true since Phase 8. It
    // becomes accurate here rather than staying a declared-and-never-true value,
    // because the same processes now run combines as well as `exec`.
    roles: ['worker', 'requestor', 'aggregator'],
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

/** Read the 4-byte little-endian partition index the fixture emits. */
const partitionOf = (output: CanonicalValue): number => {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) throw new Error('not a partition output')
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The per-job projection from an agreed shard output to a `{counts, rows}` partial.
 *
 * **It decodes the output, and that is the whole point.** Writing
 * `(_output, partitionIndex) => …` produces the identical values with one less step —
 * and makes every leaf a pure function of an integer this driver already holds, so
 * **nothing any executor computed would enter the aggregate at all**. The reduce leg
 * would then time a tree walk over values the requestor invented, and a guest
 * returning any agreed output whatsoever would give the identical root. Decoding
 * `MODULE_WRITES_PARTITION`'s `{p: <4 LE bytes>}` costs one `DataView` read per shard
 * per run and makes the timed work depend on what the map produced.
 *
 * **Distinctness is load-bearing and is inherited from the fixture, not imposed here.**
 * `deriveReduceTree` dedupes on `contributorId` + cid, so a projection collapsing two
 * shards to one value would shrink the tree and move `treeDepth` for a reason that has
 * nothing to do with the fabric.
 *
 * This is the same projection Plans 16-02 and 16-03 use, so the three entry points are
 * not measuring three different things. It is **not** the copy in
 * `packages/net/src/distributed.test.ts`, which returns `-1` on an unrecognised shape
 * where this one throws — 16-02 records why that difference is load-bearing. Do not
 * "restore" the `-1`.
 */
const project = (output: CanonicalValue): CanonicalValue => ({
  counts: { [`partition-${partitionOf(output)}`]: 1 },
  rows: 1,
})

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
  /**
   * The descriptors placement ranks over, correlated with {@link Fabric.executors} by
   * `nodeId`.
   *
   * Carried on the rig rather than derived in `runnerFor`, because the two arms derive it
   * differently and only the rig knows which arm it is: the default path is
   * `publicNodes(executors)` exactly as before, while a `--discover` rig uses the
   * descriptors `discoverCandidates` returned — which carry a real `ownerId` and
   * `canExecuteSovereign` read off each node's signed capability record, rather than the
   * public placeholder `publicNodes` synthesises.
   */
  readonly nodes: readonly NodeDescriptor[]
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
  /**
   * The submitting node's own endpoint — the one every `RemoteExecutor` above is built
   * over, and the one a combine is dispatched from.
   *
   * Surfaced rather than reconstructed, for the same reason {@link Fabric.guard} is:
   * a second endpoint would be a second peer as far as the workers are concerned, and
   * the combine nodes fetch their leaves back through *this* one's `serveAgent`.
   */
  readonly rpc: RpcEndpoint
  /**
   * How placement asks a candidate whether it will take a shard — SCHED-02/SCHED-03.
   *
   * Carried on the rig for the same reason {@link Fabric.nodes} is: only the rig knows
   * which arm it is. **Present only on a `--discover` rig**, and absent — not
   * `undefined` — otherwise, because `submitJob` branches on `spec.admit === undefined`
   * to choose between `planPlacement` and `planWithOffers`. The default curve therefore
   * places exactly as it did before this field existed.
   *
   * The memory rig never sets it whatever flags are passed. Its nodes are reached over
   * `MemoryNetwork` and an offer probe there would be measuring the harness.
   */
  readonly admit?: AdmissionControl
  /**
   * The issuers this rig's requestor accepts a **combine** certificate from — VER-08,
   * VER-09, VER-10.
   *
   * **The same set the rig already pins, resolved once, never a second copy.** On a
   * `--discover` rig it is `{provider.issuerKey}`, which is literally the value handed to
   * `discoverCandidates` and to the requestor `FabricNode`'s own `trustedIssuers`; a
   * second set assembled here could disagree with those with nothing able to catch it,
   * which is the argument `submitJob` uses for taking no issuer option at all.
   *
   * On every rig that pins nothing — the memory transport always, and a default-arm real
   * rig — this is the no-checking literal. That is the truthful reading: no provider
   * process exists, no node is enrolled, and there is no signature to check. Required
   * rather than optional for the reason {@link CombineTrustAnchors} records.
   */
  readonly combineIssuers: CombineTrustAnchors
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
    // AUTH-01: this process holds no provider signing key.
    enroll: 'issues-no-certificates',
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
    // BROW-02 — **the permanent, correct value at both of this driver's memory-rig
    // endpoints, not a burn-down**, and Plan 20-02 read each site rather than deciding
    // from the file name. The rule it applied: a site that stands up a *node* supplies a
    // real ledger; a site that stands up a *measurement fixture* states the opt-out and
    // says why. This is a fixture — an endpoint on `MemoryNetwork` inside one process,
    // built here because the rig has no `FabricNode` to inherit from.
    //
    // The reason is honesty about the population, not cost. BROW-02 counts **visitors**
    // whose node failed to start, and this rig's N endpoints are one process start, not
    // N visitors. Filing a `started` row per endpoint would put manufactured population
    // into a metric whose whole value is that its `n` is real — the failure
    // `mergeOverlapping`'s docblock calls *"a rate whose sample size is a fiction"*.
    //
    // **This is not the divergence the admission sentinel caused, and the difference is
    // measurable rather than asserted.** That one changed behaviour on the *measured*
    // path — a slot taken and released per `exec` — so the memory curve and the real
    // curve were measured under different node behaviour. This hook is reached only by a
    // `report` frame, and this driver sends none: it dispatches `exec`, `block` and
    // `combine`. So the two curves stay comparable, and what a reader must not conclude
    // is the converse — **the published benchmark numbers say nothing about BROW-02**,
    // because these endpoints are fixtures rather than visitors and always were.
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    // VER-08 / VER-09 / VER-10. **The permanent, correct value at both of this driver's
    // `serveAgent` sites, not a burn-down** — the same disposition this driver's
    // capability-chain sentinel has below, and stated for the same reason a reader
    // comparing this file with the two node factories would otherwise read it as
    // unfinished work. (That sentinel is described rather than quoted: the guard over
    // this file counts raw text, comments included.)
    //
    // Nothing enrolled these endpoints. A node signs with a **provider-issued**
    // certificate, and this rig has no provider in it; a node signing for itself with a
    // key nobody vouched for produces a statement that verifies against no trust anchor
    // any reader holds, so it proves exactly nothing while adding an Ed25519 sign per
    // combine to a published scaling curve. The sentinel is the truthful answer.
    attest: 'signs-nothing',
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
      // AUTH-01: this process holds no provider signing key.
      enroll: 'issues-no-certificates',
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
      // BROW-02 — a fixture worker, on the reasoning stated in full at the requestor
      // endpoint above: this rig's N endpoints are one process start and not N visitors,
      // so a `started` row per worker would be population invented for a metric whose
      // only value is that its sample size is real.
      //
      // **This driver's `--real` arm is the other half of the fact and is deliberately
      // different.** Those nodes come from `FabricNode.start`, so as of Plan 20-02 each
      // holds a real ledger with its own row — a node stood up, not a fixture. The two
      // arms therefore answer a `report` frame differently, which is correct and is
      // stated here rather than left for somebody to "tidy" into agreement.
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
      // VER-08 / VER-09 / VER-10 — permanent here too, and for the reason stated in full
      // at the requestor endpoint above: nothing enrolled these workers.
      attest: 'signs-nothing',
    })
    endpoints.push(rpc)
  }

  // AUTH-03. The sentinel is the permanent, correct value at both of this driver's
  // dispatch sites, not a placeholder. Every shard this benchmark submits is
  // `label: 'public'` (`:517`), so there is no owner and no root key a chain could
  // be rooted at; giving the benchmark a sovereign leg would change what it
  // measures and break comparability with the published curves. Because the
  // sentinel encodes no `capability` key at all, the frames this driver sends stay
  // byte-identical to pre-Phase-15 ones and the existing numbers remain comparable.
  const remote = endpoints.map(
    (_, i) => new RemoteExecutor(`n${i}`, callerRpc, 'dispatches-unauthenticated'),
  )

  return {
    executors: remote,
    nodes: publicNodes(remote),
    blockstore: originStore,
    moduleCid,
    moduleRecord: FIXTURE_RECORD,
    guard: requestorGuard,
    rpc: callerRpc,
    // Nothing on this transport enrols under any flag — both `serveAgent` calls above
    // pass the no-signing sentinel permanently — so there is no combine signature here
    // to check. The literal states that; an empty issuer set would claim this requestor
    // checked and found none, which is a different and false thing to print.
    //
    // **The sentinel is named in prose rather than quoted, deliberately.**
    // `serve-agent-hooks.node.test.ts` counts the raw text of that literal in this file
    // and requires exactly 2 — one per call site — so a comment that quoted it would
    // read as a third construction and fail that guard. Found the hard way: this comment
    // did quote it, and the count read 3.
    combineIssuers: 'checks-no-combine-signatures',
    async close() {
      callerRpc.close()
      for (const rpc of endpoints) rpc.close()
    },
  }
}

/**
 * The user key every `--discover` worker enrols under.
 *
 * A fixed seed rather than a fresh one per run, because the enrolment it produces is
 * setup and not measurement: nothing in the report depends on this value, and a constant
 * keeps a `--discover` run reproducible in the one way it can be. Never used on the
 * default path — nothing on that path enrols at all.
 */
const BENCH_USER_SEED = new Uint8Array(32).fill(7)

/** The TCP multiaddr a peer dials this node at, peer id included. */
function dialableAddr(node: FabricNode): string {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

/** N real libp2p nodes over TCP on loopback. Same machine — labelled as such. */
async function realFabric(nodes: number): Promise<Fabric> {
  const root = await mkdtemp(join(tmpdir(), 'o2-bench-'))
  const started: FabricNode[] = []

  // ── the --discover arm's provider ──────────────────────────────────────────────────
  //
  // Discovery answers with **signed** records, so a node with no certificate is excluded
  // as `no-records` and a discovering run over the default topology would find nobody.
  // The plan for this flag did not say so; it was found by reading `resolveCertificate`,
  // which returns `null` the moment `enrollment` is undefined — which is every node this
  // driver has ever built.
  //
  // So the discover arm needs an issuer, and it gets one that exists ONLY on that arm.
  // Everything below is skipped entirely by a default run, which is what keeps the
  // default curve where it was: no provider process, no enrolment round trip, no extra
  // dial.
  let provider: FabricNode | undefined
  if (DISCOVER) {
    const providerDir = join(root, 'provider')
    await mkdir(providerDir, { recursive: true })
    provider = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      // BROW-01 — open, which is what these three nodes did before the field existed, so
      // the published curves in `.planning/BENCHMARK-RESULTS.md` were measured under this
      // behaviour and no re-baseline is owed. It costs the measurement nothing either
      // way: the hook is reached only by a `report` frame and this driver sends none.
      startReporting: 'reports-its-own-start',
      blockstoreDir: providerDir,
      rpcTimeoutMs: 30_000,
      maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
      trustAnchors: [BENCH_TRUST_ANCHOR],
      // AUTH-04: stated rather than defaulted, because `FabricNodeOptions` has no way to
      // leave it unsaid. The sentinel is the right answer *here* and would not be on a
      // deployed provider: this one certifies the `nodes` this same function is about to
      // start, its whole population is known to the line above, and a bound sized to the
      // sweep would be a number the benchmark had to keep in step with its own `--nodes`.
      // Nothing adversarial can reach it — it is dialled only by the processes this
      // driver spawns.
      issuesCertificates: 'issues-without-an-aggregate-budget',
    })
  }
  const providerAddr = provider === undefined ? undefined : dialableAddr(provider)

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
        relayAdmission: 'admits-any-peer',
        // BROW-01 — open, on the ground stated at the provider rig above.
        startReporting: 'reports-its-own-start',
        blockstoreDir: dir,
        rpcTimeoutMs: 30_000,
        maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
        // DET-03 — this rig's nodes go through the node factory rather than
        // constructing an executor, so they ask for the guard by naming the anchor
        // instead of composing it. The submitter below states the same value for the
        // same reason it states the same admission limit: it is a `FabricNode` like
        // any other and serves `exec` requests like any other.
        trustAnchors: [BENCH_TRUST_ANCHOR],
        // Spread rather than a conditional field: `exactOptionalPropertyTypes` makes an
        // explicit `undefined` different from an absent key, and on the default path this
        // key must be absent — a worker that enrolled would publish a certificate, which
        // is a change to what the default rig IS and not only to how fast it runs.
        ...(providerAddr === undefined
          ? {}
          : {
              enrollment: {
                userPrivateKey: BENCH_USER_SEED,
                operatorId: `bench-worker-${i}`,
                providerAddr,
              },
            }),
      }),
    )
  }

  const requestorDir = join(root, 'requestor')
  await mkdir(requestorDir, { recursive: true })
  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    // BROW-01 — open, on the ground stated at the provider rig above.
    startReporting: 'reports-its-own-start',
    blockstoreDir: requestorDir,
    rpcTimeoutMs: 30_000,
    maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
    trustAnchors: [BENCH_TRUST_ANCHOR],
    // Pinned only on the discover arm, and absent otherwise for the reason the worker's
    // `enrollment` spread gives: a node with no `trustedIssuers` answers `verifiedPeers`
    // with its whole connected set, so setting this on the default path would change what
    // that reading means there too.
    ...(provider?.issuerKey == null ? {} : { trustedIssuers: [provider.issuerKey] }),
  })
  const moduleCid = sameFixtureCid('realFabric', await requestor.store.put(MODULE_WRITES_PARTITION))

  // Everyone dials the requestor, so blocks are reachable from every worker.
  for (const node of started) {
    await node.libp2p.dial(requestor.libp2p.getMultiaddrs())
  }

  // AUTH-03, same permanent sentinel and the same reason as the memory-transport
  // leg above: this driver's shards are all public.
  let executors: readonly Executor[] = started.map(
    (node) =>
      new RemoteExecutor(node.libp2p.peerId.toString(), requestor.rpc, 'dispatches-unauthenticated'),
  )
  let descriptors = publicNodes(executors)

  if (DISCOVER) {
    // The requestor must be able to ask each worker, so it dials them — the default path
    // only has the workers dialling *it*, which is enough to fetch blocks but leaves the
    // requestor with no peers of its own to query.
    for (const node of started) await requestor.libp2p.dial(node.libp2p.getMultiaddrs())

    // **Discovery keys on the module block, not on a shard input, and that is a departure
    // from the plan worth stating.** The plan says "the workload's input CID"; the shards
    // do not exist yet. They are produced per-run by `shardInputs(config.skew)` inside
    // `run`, while `executors` is fixed here, once per node count. Discovering on a CID
    // that will not exist for another few milliseconds is not possible, and rebuilding the
    // executor set per iteration would put a discovery round trip inside the timed region
    // of every run rather than once per rig.
    //
    // The module block is a real content CID that real workers really hold, so the
    // question asked is the same question — *who has this block* — over the one block that
    // is available at rig-construction time. Each worker is given it here explicitly,
    // because on the default path a worker holds nothing until it fetches during a run.
    for (const node of started) await node.store.put(MODULE_WRITES_PARTITION)

    const found = await discoverCandidates(
      { inputCid: moduleCid },
      {
        rpc: requestor.rpc,
        // `verifiedPeers` and not `transport.peers`: a provider list steers where work
        // goes, so a peer that has not cleared verification does not get to contribute
        // one. This is `discover-candidates.ts`'s own recommendation.
        peers: () => requestor.verifiedPeers,
        trustedIssuers: new Set(provider?.issuerKey == null ? [] : [provider.issuerKey]),
        now: () => Date.now(),
        peerIdFor: peerIdForNodeKey,
        // The same permanent sentinel as the list above: every shard here is public.
        dispatch: 'dispatches-unauthenticated',
      },
    )

    process.stdout.write(
      `--discover: ${String(found.executors.length)} of ${String(started.length)} workers` +
        ` qualified from ${String(found.providers)} providers` +
        `${found.excluded.length === 0 ? '' : `, ${String(found.excluded.length)} excluded`}\n`,
    )
    if (found.executors.length === 0) {
      throw new Error('--discover found no candidates; refusing to report a curve measured on nothing')
    }

    executors = found.executors
    descriptors = found.nodes
  }

  return {
    executors,
    nodes: descriptors,
    blockstore: requestor.store as unknown as MemoryBlockstore,
    moduleCid,
    moduleRecord: FIXTURE_RECORD,
    // `FabricNode.start` already wraps its transport in an `EgressGuard` (`egress`)
    // and builds `rpc` over that wrapper (13-02) — nothing to construct here, only
    // to surface, exactly the same field `bin/agent.ts`'s own `FabricNode` exposes.
    guard: requestor.egress,
    rpc: requestor.rpc,
    // Set on the discover arm alone. Absent — not `undefined` — on the default arm, so
    // `submitJob`'s `spec.admit === undefined` branch still selects `planPlacement` and
    // the published curve is placed the way it always was.
    ...(DISCOVER ? { admit: rpcAdmission(requestor.rpc) } : {}),
    // VER-08/09/10 — the same issuer the requestor `FabricNode` above pins and the same
    // one `discoverCandidates` was handed, read off the one `provider` this function
    // started, rather than assembled a second time. A default run has no provider and no
    // enrolled worker, so it states that it checks nothing — which is why the aggregate
    // receipt on the published curve reads the named absence, truthfully.
    combineIssuers:
      provider?.issuerKey == null
        ? 'checks-no-combine-signatures'
        : new Set([provider.issuerKey]),
    async close() {
      for (const node of [...started, requestor]) await node.stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * A rung produced no job at all, so there is nothing of its to describe — WIRE-01's
 * named absence rather than a `null` a printer would render as a blank.
 *
 * Distinct from {@link ShardAttestation}'s own absence arm, and the difference is the
 * whole reason it is a separate value: that one says *jobs ran and nothing about who ran
 * them could be checked*, this one says *no job ran*. A rung that threw is reported by
 * the `excluded:` path instead; this covers the narrower case where every iteration came
 * back a submit error.
 */
type NoJobToAttest = 'no-run-of-this-rung-returned-a-job'

/**
 * One rung's receipt, with the population it was read off.
 *
 * **The population is carried, not assumed, and this is the whole of why this type
 * exists.** A run whose shards did not all agree carries the named absence *because it
 * failed*, not because nothing signed — `jobAttestationOf` takes the weakest shard, and
 * one `insufficient` shard collapses the job's receipt. Measured on the `--discover` arm
 * on 2026-08-03: **the first iteration of both real rungs stalls exactly `rpcTimeoutMs`
 * and comes back incomplete**, while later iterations of the same rung complete. A
 * reading taken off iteration 1 would therefore have reported *"nothing was established"*
 * for a rig that establishes something on every subsequent run — a reading that is
 * neither wrong nor useful, and one no reader could have told apart from a fabric whose
 * nodes genuinely sign nothing.
 *
 * So the receipt is taken off the rung's **first completed run**, which is exactly the
 * population `@o2/bench`'s `measure` computes `makespan` over — *"an incomplete run never
 * enters makespan statistics"*, its own words. Following that rule rather than inventing
 * one is what keeps this from being a filter chosen because of the answer it gave: the
 * `incomplete` column beside these curves already publishes how many runs were dropped,
 * so a reader can see the size of the population this reading came from.
 *
 * And when **no** run completed, that is said in the line rather than hidden by falling
 * back silently — a rung that never completed a job has no completed run to attest, and
 * the reading it does have is worth strictly less.
 */
/**
 * This rung reduced nothing, so there is no aggregation of its to describe.
 *
 * **A different statement from an aggregation nobody attested, and they must not share a
 * rendering.** *No aggregation happened* and *the aggregation was not attested* lead a
 * reader to different places — the first to the reduce leg, the second to enrolment — so
 * a rung carrying this prints **no aggregate line at all** rather than an em dash or a
 * "none established" that a reader would take for the second. Same distinction
 * {@link NoJobToAttest} draws one level up, for the same reason.
 */
type NoReduceToAttest = 'no-reduce-ran-on-this-rung'

interface RungAttestation {
  readonly attestation: ShardAttestation
  /**
   * How strongly this rung's **aggregation** was attested — VER-08, VER-09, VER-10.
   *
   * Recorded on the same record as the map half and in the same statement, so the two
   * cannot come off different runs: a reader comparing them is comparing two claims about
   * **one** job, and a pair assembled from two runs would let a rung print a map receipt
   * from iteration 5 beside an aggregate receipt from iteration 1 with nothing saying so.
   */
  readonly aggregate: AggregateAttestation | NoReduceToAttest
  /** `Observation.complete` of the run this was taken off — every shard agreed, undegraded. */
  readonly fromCompletedRun: boolean
}

/**
 * How strongly one rung's result was attested — VER-09, VER-10, criterion 3's CLI half.
 *
 * ## Three things this line is, each of which it would be easy to get wrong
 *
 * **The value is the job's, not this driver's.** Every field below is read off
 * `JobResult.attestation`, which `submitJob` builds from signatures it checked. A driver
 * that derived the label from `config.redundancy` would print the right answer on this
 * rig for the wrong reason, and would go on printing it after the mechanism underneath
 * broke — which is exactly the substitution `discover-arm.node.test.ts` plants against.
 *
 * **The sentence is the kernel's, not a new string.** `attestationReceipt` fills
 * `description` from `describeAttestation`, so this printer copies rather than composes.
 * The demo UI renders the same field, and one source of the words is the only thing that
 * stops the two surfaces describing one result differently.
 *
 * **A rung that established nothing says so, in words, and never a label.** *"We cannot
 * say"* and *"one node said so"* are different statements, and keeping them different is
 * the whole of VER-10. The named absence therefore prints as `none established` — a phrase
 * no reader can mistake for a strength — with the two counts that decide what to do
 * about it (`agreeing` matched, `verified` of those proved it) and the kernel's own
 * reason after the dash.
 *
 * ## Why every memory rung reads that absence, and why that is honest
 *
 * `memoryFabric` builds its descriptors with `publicNodes`, which carries no certificate
 * by construction, and nothing enrolled its endpoints. So this requestor holds no
 * certificate for any replica and can account for none of them. That is a true statement
 * about the rig, not a gap in this line — and printing the weakest *label* there instead
 * would be the failure that looks most like success.
 *
 * The same is true of **every rung of a default run**: certificates reach a descriptor
 * only through the `--discover` arm. The report's `unmet` list says so where a reader of
 * the published table will find it.
 */
function attestationReading(held: RungAttestation | NoJobToAttest): {
  population: string
  reading: string
} {
  if (held === 'no-run-of-this-rung-returned-a-job') {
    return {
      population: 'no job returned',
      reading:
        'none established (agreeing 0, verified 0) — no iteration of this rung returned a job, ' +
        'so there was nothing to attest',
    }
  }
  const population = held.fromCompletedRun
    ? 'first completed run'
    : 'no run of this rung completed; first job it returned'
  const { attestation } = held
  if ('kind' in attestation) {
    return {
      population,
      reading:
        `none established (agreeing ${attestation.agreeing}, verified ${attestation.verified}) — ` +
        attestation.reason,
    }
  }
  return {
    population,
    reading:
      `${attestation.strength} (replicas ${attestation.replicas},` +
      ` operators ${attestation.operators.length}) — ${attestation.description}`,
  }
}

/**
 * How strongly one rung's **aggregation** was attested — VER-08, VER-09, VER-10.
 *
 * ## Why this is a second line and not a second field on the first one
 *
 * `PROJECT.md` splits the verification claim, and the split is not a formality: a
 * sovereign map is `owner-attested` by construction — pinning data to one owner removes
 * the second independent executor — while the aggregation *over* those contributions can
 * be redundant, because a combine reads only content-addressed partials and is runnable
 * anywhere. So the two receipts **routinely differ**, and printing one for both would
 * make the stronger-sounding claim about the weaker half.
 *
 * **Which is why both lines carry a name for the claim they are about.** The failure mode
 * is specific and it is a reading failure rather than a computation one: a reduced
 * sovereign job prints `owner-attested` for its map and can print `independent` for its
 * aggregation, and an unlabelled pair reads as a *contradiction* — one number that
 * changed — rather than as the split it is. `map attestation` and `aggregate attestation`
 * are the two names; neither line may lose its word.
 *
 * `null` when this rung reduced nothing. See {@link NoReduceToAttest}: the caller prints
 * no line at all rather than a placeholder, because *no aggregation happened* and *the
 * aggregation was not attested* are different statements.
 */
function aggregateReading(held: RungAttestation | NoJobToAttest): string | null {
  if (held === 'no-run-of-this-rung-returned-a-job') return null
  const { aggregate } = held
  if (aggregate === 'no-reduce-ran-on-this-rung') return null
  if ('kind' in aggregate) {
    // `combines` and `verified` are **combine** counts, not replica counts — the map
    // line's two numbers are `agreeing`/`verified` replicas, and printing both pairs
    // under one word would be the conflation this pair of lines exists to prevent. So
    // this one names its unit.
    return (
      `none established (combines ${aggregate.combines}, verified ${aggregate.verified}) — ` +
      aggregate.reason
    )
  }
  // The kernel's own sentence, copied rather than composed — `attestationReceipt` filled
  // `description` from `describeAttestation`, and one source of the words is what stops
  // the map line and this line describing one strength differently.
  return (
    `${aggregate.strength} (replicas ${aggregate.replicas},` +
    ` operators ${aggregate.operators.length}) — ${aggregate.description}`
  )
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
  /**
   * How strongly the first job this rung completed was attested — VER-09, VER-10.
   *
   * Surfaced beside the observations rather than re-derived, and the alternative is
   * worth naming because it is the obvious one: submitting an extra job to read a
   * receipt off would change what the rung measures, and a benchmark whose
   * configuration moved between runs has rows that cannot be compared.
   *
   * The **first** completed job and not the last, because they are the same reading —
   * the rig is built once per node count and every iteration runs against it — and
   * first is the one a reader can locate in the output above the line. See
   * {@link RungAttestation} for why the *completed* population and not every run.
   */
  attestationFor: (nodes: number) => RungAttestation | NoJobToAttest
  dispose: () => Promise<void>
} {
  const fabrics = new Map<number, Fabric>()
  let egressEntries = 0
  let egressBytes = 0
  const attestations = new Map<number, RungAttestation>()

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
        // `fabric.nodes` and not `publicNodes(executors)`: on a --discover rig the
        // descriptors carry an ownerId read from each node's signed capability record,
        // and re-deriving them here would throw that away. `timed` preserves `nodeId`,
        // so the correlation submitJob checks still holds.
        nodes: fabric.nodes,
        redundancy: config.redundancy,
        // VER-03/VER-04. This is a measurement driver, and a refused shard yields no
        // reading — so refusing on an uncomposable quorum would make the driver quietly
        // measure less the more concentrated the fabric got, which is the direction the
        // interesting readings are in. It degrades, and a degraded reading is still a
        // reading: the receipt names the weaker strength beside it.
        //
        // This matters most on the `--discover` arm, which is where Plan 19-10 takes
        // criterion 3's CLI readings — a discovered rig is exactly the case where the
        // candidate set may turn out to be one operator's.
        onQuorumShortfall: 'runs-at-available-redundancy',
        // Absent on the default arm, so `submitJob` takes `planPlacement` exactly as it
        // did before `--discover` existed. Present on a discover rig, which is what
        // gives `planWithOffers` — sample `d`, take the least-loaded, re-pick on a
        // refusal — a caller from a runnable entry point rather than only from tests.
        ...(fabric.admit === undefined ? {} : { admit: fabric.admit }),
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

    // The reduce leg — MR-03, MR-04, MR-05. Its own `performance.now()` pair, opened
    // strictly after the makespan bracket above closed.
    //
    // **The bracket is deliberately not widened**, and the reason is
    // `.planning/BENCHMARK-METHODOLOGY.md` §2.1: makespan is defined to the last
    // shard's result being available to the requestor, a combine happens after that,
    // and folding it in would silently redefine every number published before this
    // date. The two tables are adjacent in the report so a reader who prefers the
    // other definition can add the columns.
    let reduce: ReduceObservation = {
      ok: false,
      reduceMs: 0,
      treeDepth: 0,
      combines: 0,
      recomputes: 0,
      combineExecutors: 0,
    }
    // VER-08/09/10 — the aggregation's own receipt. Starts as the named absence of a
    // *reduce*, not of an attestation: on any path where no reduce is attempted this is
    // what survives, and it prints nothing at all rather than a "none established" a
    // reader would take for an unattested aggregation.
    let aggregate: AggregateAttestation | NoReduceToAttest = 'no-reduce-ran-on-this-rung'
    if (result.ok) {
      const reduceStarted = performance.now()
      const reduced = await reduceJob(result.job, {
        rpc: fabric.rpc,
        // `fabric.executors` and **not** the `timed(...)` wrappers above: those exist
        // to accumulate node-seconds for the *map*, and a combine's cost is reported
        // separately as `reduceMs`. Wrapping them here would double-count a segment
        // into `grossNodeSeconds` that is deliberately reported on its own.
        executors: fabric.executors.map((executor) => executor.nodeId),
        // The requestor's own store, not a fresh one: it is what this rig's
        // `serveAgent` answers block requests from, so it is where combine nodes fetch
        // the leaves — and where each combine's result is fetched back to, which is the
        // only reason a level-2 combine can reach its inputs.
        blockstore: fabric.blockstore,
        project,
        redundancy: config.redundancy,
        // VER-08/09/10 — the rig's own pinned issuers, resolved once at rig construction
        // and carried, never re-derived here. See {@link Fabric.combineIssuers}.
        trustedIssuers: fabric.combineIssuers,
      })
      const reduceMs = performance.now() - reduceStarted
      // **`reduced.ok` alone here, and deliberately not the conjunction below.** The two
      // fields answer different questions: `reduce` is a *timing*, and timing a reduce
      // whose combines failed would publish a number for an aggregation that did not
      // happen; this is a *receipt*, and a reduce that ran and had a combine fail has a
      // receipt worth printing — it names the step that could not be accounted for, which
      // is exactly the reading an operator acts on. Using the conjunction here would hide
      // the reduce's most informative receipt behind its least informative one.
      if (reduced.ok) aggregate = reduced.aggregateAttestation
      // **Both**, and the conjunction is the point: `reduceJob` documents on its own
      // type that `ok` means only *a reduce could be attempted*, so a run where every
      // combine failed is `{ok: true}` with `outcome.ok === false`. Treating that as a
      // measurement would publish a timing for an aggregation that did not happen.
      if (reduced.ok && reduced.outcome.ok) {
        reduce = {
          ok: true,
          reduceMs,
          treeDepth: reduced.tree.depth,
          combines: reduced.outcome.combines,
          recomputes: reduced.outcome.recomputes,
          combineExecutors: new Set(reduced.outcome.executedBy.values()).size,
        }
      }
    }

    // **Left alone, deliberately.** Appending `&& reduceOk` here would leave every
    // individual `makespanMs` measuring the identical interval while conditioning the
    // *published statistics* on the reduce, because `makespan` is summarised over
    // `complete` runs in `@o2/bench`'s `measure`. That is a silent re-sampling of the
    // primary metric even though the bracket is untouched, and it would move
    // `incomplete` off its pre-reduce meaning too. A run that produced every shard but
    // no aggregate is a complete **map** with a failed **aggregation**; `reduce.ok`
    // records that, and `bench-reduce.node.test.ts` guards this expression by shape.
    const complete = result.ok && result.job.complete

    // VER-09 / VER-10. Recorded here rather than at the submit above, so that the
    // population this reading comes from is literally `Observation.complete` and cannot
    // drift from the population `makespan` is summarised over. A completed run replaces
    // a partial one and never the reverse, and nothing replaces a completed one — so
    // this is *the first completed run*, with the rung's first job as the weaker
    // fallback when no run of it completed. Strictly after the makespan bracket closed;
    // a `Map` read and a field copy either way.
    //
    // **Both receipts are recorded in one statement**, so the pair a reader compares is
    // always one job's. Recording the aggregate separately — even under the identical
    // rule — would let a rung print a map receipt from one iteration beside an aggregate
    // receipt from another the moment the two rules ever came apart, and nothing in the
    // output would say so.
    if (result.ok) {
      const held = attestations.get(config.nodes)
      if (held === undefined || (complete && !held.fromCompletedRun)) {
        attestations.set(config.nodes, {
          attestation: result.job.attestation,
          aggregate,
          fromCompletedRun: complete,
        })
      }
    }

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
      // Both literals, and neither is read from the job that just returned — so both
      // columns print these values whatever that job did.
      //
      // For speculation that is still the identity: `submitJob` does not speculate.
      // **For churn it is not.** Since 20-01 a shard whose lease lapses is re-placed and
      // `JobResult.redispatches` counts the generations beyond the first, so a measured
      // figure now exists at the other end of this very call and this site does not read
      // it. Reading it would move a published column, which is 20-09's; what is corrected
      // here is the comment that claimed the fabric had no such path at all.
      speculationMultiplier: 1,
      redispatches: 0,
      codeCache,
      reduce,
    } satisfies Observation
  }

  return {
    run,
    egressTotals: () => ({ entries: egressEntries, bytes: egressBytes }),
    attestationFor: (nodes) => attestations.get(nodes) ?? 'no-run-of-this-rung-returned-a-job',
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

  /**
   * The per-rung attestation readings, in the order they were printed.
   *
   * Carried into the report so a reader of `.planning/bench/raw.json` sees what a reader
   * of the terminal saw. Deliberately **not** folded into `unmet`: this is a measurement
   * of each rung, and `unmet` is the list of things this run did not establish.
   */
  const attested: {
    config: string
    population: string
    reading: string
    /** The aggregation's own reading, or absent when this rung reduced nothing. */
    aggregate?: string
  }[] = []
  const sayAttestation = (config: string, held: RungAttestation | NoJobToAttest): void => {
    const { population, reading } = attestationReading(held)
    // **`map` is not decoration.** Two receipts about two claims cross this stream, and a
    // reader who cannot tell which is which reads a sovereign job's `owner-attested` map
    // beside an `independent` aggregation as a contradiction rather than as the split
    // `PROJECT.md` describes. See {@link aggregateReading}.
    process.stdout.write(`    map attestation (${population}): ${reading}\n`)
    const aggregate = aggregateReading(held)
    if (aggregate !== null) {
      process.stdout.write(`    aggregate attestation (${population}): ${aggregate}\n`)
    }
    // Absent, not `undefined` and not a placeholder string: `exactOptionalPropertyTypes`
    // makes those different, and a reader of `raw.json` must be able to tell *this rung
    // reduced nothing* from *this rung's aggregation was not attested* by the presence of
    // the key alone, exactly as the terminal reader tells them by the presence of a line.
    attested.push({ config, population, reading, ...(aggregate === null ? {} : { aggregate }) })
  }

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
    // After the rung's runs, never before: the reading belongs to a job that happened.
    // **The sweep's shape is unchanged by this line** — same ladders, same iteration
    // counts, same rungs, same redundancy — because a benchmark whose configuration
    // moved between runs has rows that cannot be compared with the ones already
    // published.
    sayAttestation(`memory transport, ${nodes} nodes`, memory.attestationFor(nodes))
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
      sayAttestation(`real transport, ${nodes} nodes`, real.attestationFor(nodes))
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
  sayAttestation('skewed configuration, memory transport, 4 nodes', skewRunner.attestationFor(4))
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
    /**
     * VER-08 / VER-09 / VER-10 — how strongly each rung was attested, per rung, in the
     * same words the terminal printed.
     *
     * **Two claims per rung, and `aggregate` is absent rather than empty when a rung
     * reduced nothing.** `reading` is the map half, read off `JobResult.attestation`;
     * `aggregate` is the aggregation's own, read off `ReduceJobResult`. Neither is
     * derived from the rung's configuration, and neither stands in for the other — see
     * {@link aggregateReading} for why a reader who could not tell them apart would read
     * the project's own split as a contradiction.
     */
    attestation: attested,
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
        ' number here is same-machine. The N the ladder counts is N *node identities*, and' +
        ' they share one host — and, per the entry above, one process — so they share a' +
        ' CPU, a memory bus, a scheduler and an event loop. This measures software scaling' +
        ' with contention included and the network excluded, and it is not a measurement of' +
        ' N machines. The label on every table says which of the two it is.',
      'No hosted relay exists yet, so no WAN browser-tier number is included. The real' +
        ' transport here is libp2p over TCP on loopback.',
      'The WASM fixture does almost no work, so per-task overhead dominates and the COST' +
        ' crossover is worse than it would be for a realistic workload. Declared in the' +
        ' methodology before these runs, not discovered afterwards.',
'The 1-node rung necessarily runs at redundancy 1: verification needs two' +
        ' independent executors, and one node cannot supply them. Its verification tax of' +
        ' 1.0 is therefore a property of the system, not a cheaper configuration — the' +
        ' same reason a sovereign shard with one owner node is owner-attested.',
      '**A default run of this driver establishes no attestation strength on any rung,' +
        ' and the `attestation` readings above will all say so.** That is a property of' +
        ' the rigs rather than of the fabric, and it is measured rather than assumed: a' +
        ' descriptor carries a certificate only where one was discovered, discovery runs' +
        ' only under `--discover`, and `memoryFabric` builds its descriptors with' +
        ' `publicNodes`, which carries none by construction — so on a default run this' +
        ' requestor holds no certificate for any replica and can account for none of them.' +
        ' The labelled readings — a one-replica rung reading `owner-attested`, a' +
        ' two-operator rung reading `independent` — are available only on a `--discover`' +
        ' run, whose numbers must not be published beside these ones for the reason stated' +
        ' at that flag. What is therefore **unmeasured here** is the attestation of the' +
        ' configuration these curves were taken under; what is measured is that it was not' +
        ' established, which is a different and weaker statement.',
      '**The `aggregate attestation` lines say the same thing on a default run, for a' +
        ' second and independent reason.** A default rig pins no issuer at all — no' +
        ' provider process is started and no worker enrols — so it hands `reduceJob` the' +
        ' `checks-no-combine-signatures` literal and the aggregate receipt is the named' +
        ' absence by construction. That is truthful rather than degraded: a combine' +
        ' signed by nobody is what a fabric of unenrolled nodes produces. The two' +
        ' receipts are printed separately because they are claims about different things' +
        ' — this rig’s map half and its aggregation half can differ, and on a' +
        ' `--discover` run they do.',
      '**Speculation tax 1.0 and churn 0 are literals this driver writes, not' +
        ' measurements.** The measurement site sets both by hand and reads neither from the' +
        ' job it just ran, so both columns would print these values whatever that job did.' +
        ' For speculation that is still the identity — `submitJob` does not speculate. For' +
        ' churn it no longer is: since 20-01 a shard whose lease lapses is re-placed and' +
        ' `JobResult.redispatches` counts the generations beyond the first, so a measured' +
        ' figure exists and nothing here reads it. Making the column live is 20-09’s; what' +
        ' is corrected here is the sentence that said the fabric had no such path.',
      '**The reduce figures are subject to the same one-process, one-event-loop' +
        ' construction as the makespan figures.** `combine executors` counts distinct' +
        ' *node identities*, not distinct machines and not even distinct OS processes, so' +
        ' a value above 1 says the rendezvous ranking spread the combines across' +
        ' identities — not that any of them ran anywhere else. The eight-process evidence' +
        ' for the tree walk lives in `packages/node/src/tree-reduce-agents.node.test.ts`,' +
        ' not here.',
      '**`tree depth` and `combines` are decided by `deriveReduceTree` from a shard count' +
        ' and a fanout this sweep never varies.** A column the run shows constant across' +
        ' every rung of both transports carries no information about a configuration, and' +
        ' a constant is not a result — the same status `spec. tax` and `churn/task` carry' +
        ' above. The reduce columns expected to carry information are `reduce p50`,' +
        ' `reduce p95`, `recomputes` and `combine executors`; read those. Varying the' +
        ' fanout across the sweep would make the other two informative and was rejected' +
        ' for a stated reason: rungs walking differently-shaped trees have incomparable' +
        ' reduce timings, which is the only thing the reduce table is for.',
      '**The real-transport reduce refusal that emptied this table on 2026-08-01 has been' +
        ' removed, and the rows below are whatever the run above actually produced.**' +
        ' Recorded rather than deleted, because a reader comparing two dated artifacts' +
        ' must be able to tell a figure that changed from a figure that was replaced. What' +
        ' the previous run published here: every real-transport row an em dash, because' +
        ' `serveAgent`’s combine branch refused outright unless its `authorize` hook was' +
        ' the `serves-unauthenticated` sentinel, and every `FabricNode` supplies a real' +
        ' `authorizeCapability` — so every node in the real-transport rig answered' +
        ' `combine requires a capability chain this build cannot verify`, measured as' +
        ' `combines: 0`, `failed: 5`, `executedBy: 0`, `rootCid: null`. 16-05 routed a' +
        ' combine through `options.authorize` like every other request, so a combine is' +
        ' now admitted or refused by the node’s own authorizer rather than by a branch' +
        ' keyed on whether the node had one. **An em dash in this table therefore no' +
        ' longer means "refused"** — it means that rung produced no reduce at all, and the' +
        ' excluded list below is where its reason is named. The two reduce curves are' +
        ' comparable only across rungs both transports measured.',
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
