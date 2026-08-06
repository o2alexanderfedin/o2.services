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
  delegate,
  describeCoverage,
  guardModuleProvenance,
  publicNodes,
  signName,
} from '@o2/core'
// `AdmissionControl`, `NodeDescriptor` and `CombineTrustAnchors` are no longer named
// here: they were the member types of this file's own copy of the `Fabric` seam, which
// now has one home in `../bench-fabric.ts`.
import type {
  CanonicalValue,
  Delegation,
  Executor,
  JobResult,
  NameRecord,
  PublicKeyHex,
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
import type { AggregateAttestation, CapabilitySupplier } from '@o2/net'
import { audienceKeyOf, peerIdForNodeKey } from '@o2/libp2p'
import {
  HarnessIntegrityError,
  MAX_DRIVER_CPU_SHARE,
  NODE_LADDER,
  assertIntegrity,
  connectivityTax,
  costCrossover,
  cpuAttributionViolations,
  describeExclusion,
  fixtureProvenanceViolations,
  fixtureUniformityViolations,
  measure,
  processIdentityViolations,
  renderMarkdown,
  summarise,
} from '@o2/bench'
import type {
  CpuAttribution,
  DriverKind,
  ObservedFailure,
  FixtureKind,
  Inventory,
  JobRunner,
  Machine,
  Observation,
  ProcessIdentity,
  ReduceObservation,
  RunConfig,
  SweepResult,
} from '@o2/bench'
// The saturating fixture, by name across a declared package boundary — the shape the
// relative import below is being moved away from. That one stays only because the
// trivial fixture stays. `@o2/demo` is a portable package whose own dependencies are
// `@o2/core` and `multiformats`, and `packages/node` is in neither `purity`'s
// `PORTABLE` nor its `DUAL_TARGET` list, so this edge points adapter -> portable.
import { DEFAULT_BUDGET, buildInput, kernelBytes, readPartial } from '@o2/demo'
import { MODULE_WRITES_PARTITION } from '../../../core/src/executor/fixtures.ts'
import { processFabric } from '../bench-fabric.ts'
import type { AgentHandle, DialDirection, Fabric, ProcessFabric, SubmitterReading } from '../bench-fabric.ts'
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

/**
 * Mint a real capability chain and dispatch one owner-labelled shard through it —
 * AUTH-03's requestor half. Off by default. **Requires {@link DISCOVER}.**
 *
 * ## Why the flag exists
 *
 * `delegate` (`@o2/core`) and `CapabilitySupplier` (`@o2/net`) were complete, fuzzed and
 * verified at the *serving* end in Phase 15, and had **zero production callers**: all five
 * production dispatch sites label their shards public, a public task has no owner, and a
 * task with no owner has no root key a chain could be rooted at. Owner ruling 2026-07-31
 * declined to ship that as accepted-unreachable — naming a gap is not closing it — and
 * routed the fix to this driver, because this phase already rewrites its node
 * construction. This flag is that call path.
 *
 * ## Why it is off by default
 *
 * The same reason {@link DISCOVER} is, and it is the reason rather than a matching style:
 * a published scaling curve must not be reshaped by a change nobody declared. With this
 * flag absent, `realFabric` builds exactly what it built before the flag existed — no
 * `sovereignty` key reaches any node, no chain is minted, no owner-labelled shard is
 * submitted and nothing extra is dispatched. The default run measures what it measured
 * yesterday, and `coverage-agents.node.test.ts` reads that off this driver's own stdout.
 *
 * ## Why it REQUIRES `--discover` and does not imply it
 *
 * A sovereign shard is placed only against a descriptor whose `ownerId` matches it
 * (`eligibleNodes`, `core/src/sovereignty.ts`), and `publicNodes` hardcodes the literal
 * `'public'` there — so the default descriptor derivation cannot place one at all.
 * Hand-building a second `NodeDescriptor[]` here to work around that would create a second
 * producer of the same record, able to disagree with `discoverCandidates`' with nothing in
 * the repository to catch it: the field-with-two-answers shape `fabric-node.ts` exists to
 * name. Riding the discover arm instead reads `ownerId` and `canExecuteSovereign` off a
 * **signed** capability record, which is what makes this an AUTH-03 path rather than a rig.
 *
 * It refuses rather than implying, and that is deliberate. A `--discover` run stands up a
 * provider and enrols every worker, so its node population is N+2 rather than N+1 and the
 * report has to declare it. A run whose topology changed for a reason the operator did not
 * type is the failure this driver's whole opt-in discipline exists to prevent.
 *
 * ## It is not a node kind
 *
 * Every node in either leg is the same node. What differs is the label on one shard and
 * the per-node clearance those nodes were configured with — the sentence
 * `FabricNodeOptions.sovereignty` already carries about itself.
 *
 * Read the way `--quick` and `--discover` are read: `process.argv.includes`, not
 * `parseArgs`, because this file has none.
 */
const SOVEREIGN = process.argv.includes('--sovereign')

/**
 * The refusal, in the shape `bin/agent.ts`'s `refuse` already uses — a named reason, then
 * the usage line, then a non-zero exit.
 *
 * Before anything is constructed, so the cost of a mistyped invocation is one write and an
 * exit rather than a rig. See {@link SOVEREIGN} for why this is a refusal and not
 * `DISCOVER ||= SOVEREIGN`.
 */
if (SOVEREIGN && !DISCOVER) {
  process.stderr.write(
    'bench.ts: --sovereign requires --discover and does not imply it — a sovereign shard is' +
      ' placed only against a discovered descriptor, and a --discover run has a different node' +
      ' population that the report must declare.\n' +
      'usage: bench.ts [--quick] [--discover [--sovereign]]\n',
  )
  process.exit(2)
}

const QUICK = process.argv.includes('--quick')
const RUNS = QUICK ? 6 : 20
const LADDER = QUICK ? [1, 2, 4] : NODE_LADDER
/** Real libp2p nodes are expensive to stand up; the ladder is shorter and declared. */
const REAL_LADDER = QUICK ? [1, 2] : NODE_LADDER
/**
 * The ladder both fixed-redundancy speedup sweeps run — BENCH-07 criterion 2.
 *
 * It reaches 8 because the criterion names N=1 and N=8. It stops there rather than at 16
 * because the process-per-node driver runs `nodes + 1` node processes per rung and this
 * host reports 8 logical cores, so a 16-node rung is oversubscribed by more than a factor
 * of two before the driver's own process is counted. The rungs that *are* oversubscribed
 * are named as such beside the curve, from the observed process count rather than from
 * the rung's node count.
 *
 * **Not run under `--quick`, and this is a declared cost rather than an omission.** Three
 * specs spawn this driver; `coverage-agents.node.test.ts` spawns it with `--quick`, waits
 * for the whole run inside 180 s and asserts the exit code is 0. A saturating fixture
 * across spawned processes is minutes of work by construction, and an integrity failure
 * on any rung leaves through `main()` by design — so running these sweeps there would
 * make a guard about coverage rendering fail for reasons about neither. What it costs is
 * worth stating plainly: **nothing in any suite executes a rung of these sweeps**, which
 * is already true of every other rung of this driver, whose `main()` runs on import.
 * These checks fire when a human runs the benchmark, not when a change breaks it.
 */
const SPEEDUP_LADDER: readonly number[] = [1, 2, 4, 8]
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
 * The bound the saturating fixture searches to, per shard.
 *
 * **Measured 2026-08-05 at {@link SHARDS} partitions**, against three acceptance
 * conditions and nothing else:
 *
 * 1. every one of the sixteen shards ends on `budget` — a cube that finds a colouring
 *    returns early, so shard cost stops being uniform and a ratio across the ladder
 *    would be measuring the search rather than the fabric;
 * 2. the encoded input stays under `WIRE_CHUNK_BYTES` (16 384), so the transport regime
 *    does not change between the two fixtures;
 * 3. the partition count is a power of two, which the guest's packing rule requires and
 *    which 16 satisfies.
 *
 * The value is what was measured, not what was reasoned out: candidates below this one
 * were watched returning at least one `found` shard at sixteen partitions, and
 * candidates above it were watched crossing the wire bound. **No per-shard duration, no
 * serial total and no expected speedup is written here** — those are runtime quantities,
 * the run measures them, and a figure in a comment is exactly what this phase exists to
 * remove. What the fixture cost at eight partitions is not quoted anywhere: `SHARDS` is
 * sixteen, and a figure taken at another partition count is about another configuration.
 *
 * The budget is `DEFAULT_BUDGET`, imported rather than restated, so there is one home
 * for it and this driver cannot drift from the value the demo tier ships.
 */
const SATURATING_N = 600
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
/** Vouches for the **trivial** module — `MODULE_WRITES_PARTITION`. */
const FIXTURE_RECORD: NameRecord = signName(BENCH_SIGNING_SEED, {
  name: BENCH_MODULE_NAME,
  cid: FIXTURE_MODULE_CID,
  version: 1,
  expiresAt: Date.now() + 3_600_000,
})

/** The name the saturating module is published under, distinct from the trivial one. */
const SATURATING_MODULE_NAME = 'o2-bench-saturating-module'
const SATURATING_MODULE_CID: CID = await new MemoryBlockstore().put(kernelBytes)
/**
 * Vouches for the **saturating** module — `@o2/demo`'s colouring kernel.
 *
 * Not optional and not shareable with the record above: `guardModuleProvenance` refuses a
 * task whose record does not vouch for its module, so a saturating rig handed the trivial
 * record refuses every shard. Signed by the same seed, so `BENCH_TRUST_ANCHOR` is
 * unchanged and every rig still pins exactly one value.
 */
const SATURATING_RECORD: NameRecord = signName(BENCH_SIGNING_SEED, {
  name: SATURATING_MODULE_NAME,
  cid: SATURATING_MODULE_CID,
  version: 1,
  expiresAt: Date.now() + 3_600_000,
})
/** The public half, read off the record rather than re-derived from the seed. */
const BENCH_TRUST_ANCHOR: string = FIXTURE_RECORD.signer

/**
 * Each fixture's module CID, **built from the bytes** rather than from the name.
 *
 * `RunConfig.fixture` is filled in by the call site, so every downstream heading, column
 * and ratio inherits whatever the caller typed. This registry is the other end of that:
 * `fixtureProvenanceViolations` compares it against the CID the rung's fabric actually
 * put, which is what makes `fixture: 'saturating'` a fact about bytes rather than a
 * label. Deriving these entries from the declared names instead would make that
 * comparison a tautology.
 */
const FIXTURE_CIDS: Readonly<Record<FixtureKind, string>> = {
  trivial: FIXTURE_MODULE_CID.toString(),
  saturating: SATURATING_MODULE_CID.toString(),
}

/** The bytes each fixture dispatches. One home per fixture, read by every rig. */
function moduleBytesFor(fixture: FixtureKind): Uint8Array<ArrayBuffer> {
  return fixture === 'saturating' ? kernelBytes : MODULE_WRITES_PARTITION
}

/** The record that vouches for {@link moduleBytesFor}'s bytes to this rig's nodes. */
function recordFor(fixture: FixtureKind): NameRecord {
  return fixture === 'saturating' ? SATURATING_RECORD : FIXTURE_RECORD
}

/**
 * Fail loudly if a rig's store addressed its fixture differently from the record.
 *
 * Cheap, and it converts a whole-rig silent zero into one named throw at start-up. The
 * expected CID is an argument rather than a constant, because there are two modules now
 * and a rig that addressed the saturating one while holding the trivial record would
 * otherwise get the same silent zero this exists to convert.
 */
function sameFixtureCid(rig: string, moduleCid: CID, expected: CID): CID {
  if (moduleCid.toString() !== expected.toString()) {
    throw new Error(
      `${rig} addressed its fixture module as ${moduleCid.toString()} but the signed record ` +
        `names ${expected.toString()} — every shard would be refused as a cid-mismatch`,
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

/**
 * The job: `SHARDS` partitions of the fixture module, one input block.
 *
 * **The saturating arm hands every shard the identical bytes, and that is the kernel's
 * design rather than a shortcut here.** `@o2/demo`'s job module states it: every shard of
 * a colouring job receives the same input block, and shards differ only by what
 * `partition()` tells the guest — which costs zero bytes on the wire. `submitJob` indexes
 * shards positionally (`shardId` is the partition index, and the admission slot key is
 * `inputCid:partitionIndex`), so sixteen identical values are sixteen distinct shards.
 *
 * `skew` has no meaning on that arm for the same reason: there is one input and the
 * fixture's cost is a declared budget rather than a payload size. Both saturating sweeps
 * declare `skew: 'uniform'`, which is what they run.
 */
async function shardInputs(
  skew: RunConfig['skew'],
  fixture: FixtureKind,
): Promise<readonly CanonicalValue[]> {
  if (fixture === 'saturating') {
    const input = buildInput(SATURATING_N, DEFAULT_BUDGET)
    return Array.from({ length: SHARDS }, () => input)
  }
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

/**
 * What one run's executor calls cost, accumulated by {@link timed}.
 *
 * **`calls` holds dispatch-to-response intervals and they OVERLAP.** The clock starts
 * when the driver calls `inner.execute` and stops when the response lands, and
 * `submitJob` dispatches a generation's shards concurrently — so a sum of these is not a
 * serial total and the largest of them is not the slowest shard's own duration.
 * `sum(calls) / max(calls)` is therefore **not** `serialTotal / maxShard` and must not be
 * published as it, whatever value it takes. The derived ideal comes from
 * {@link calibratePerShard}, which makes the driver-side clock a per-shard clock by
 * construction. The array is still carried into `raw.json`, labelled for what it is,
 * because it is what the node-seconds are made of.
 */
interface CostAccumulator {
  gross: number
  perNode: Map<string, number>
  calls: number[]
}

/** Wraps an executor so every call's wall time is recorded. */
function timed(inner: Executor, into: CostAccumulator): Executor {
  return {
    nodeId: inner.nodeId,
    async execute(task: Task) {
      const started = performance.now()
      try {
        return await inner.execute(task)
      } finally {
        const elapsedMs = performance.now() - started
        const elapsed = elapsedMs / 1000
        into.gross += elapsed
        into.calls.push(elapsedMs)
        into.perNode.set(inner.nodeId, (into.perNode.get(inner.nodeId) ?? 0) + elapsed)
      }
    },
  }
}

/*
 * The `Fabric` seam is imported from `../bench-fabric.ts` rather than declared here.
 *
 * It was declared in this file until Plan 23-03, in a copy whose `blockstore` was
 * narrowed to `MemoryBlockstore` — which is why `realFabric` ended its return literal
 * with an `as unknown as MemoryBlockstore` cast over a store that is not one. The copy in
 * `bench-fabric.ts` widens that member to `Blockstore` and `moduleCid` follows it, so the
 * cast is deleted below rather than carried. Two declarations of one seam is the "field
 * with two answers" shape this repository names elsewhere: a rig satisfying one and not
 * the other would be a compile error nobody could act on.
 *
 * Every member's reasoning lives there, beside the declaration, so there is one home for
 * each. `ProcessFabric` extends it with the spawned agents and the submitting node's peer
 * id, which is what the identity reading needs.
 */

/** N nodes on the in-process transport. */
async function memoryFabric(nodes: number): Promise<Fabric> {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()
  const moduleCid = sameFixtureCid(
    'memoryFabric',
    await originStore.put(MODULE_WRITES_PARTITION),
    FIXTURE_MODULE_CID,
  )

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

  // AUTH-03. The sentinel is the permanent, correct value **on this rig**, not a
  // placeholder — and the sentence that used to stand here said it was permanent at *both*
  // of this driver's dispatch sites because every shard the benchmark submits is public.
  // That ground is now false on one arm and the claim is narrowed rather than deleted: the
  // `--sovereign` leg dispatches one owner-labelled shard, and it does so on the real
  // transport only. It cannot be run here, and the reason is not cost: these endpoints
  // state the unauthenticated serving disposition permanently, so a chain would be accepted
  // without ever being verified and a leg over them would prove nothing at all.
  //
  // Every shard *this* rig submits is public, so there is no owner and no root key a chain
  // could be rooted at. And because the sentinel encodes no `capability` key, the frames
  // this rig sends stay byte-identical to pre-Phase-15 ones and its published numbers
  // remain comparable.
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

/**
 * The public half of {@link BENCH_USER_SEED}, hex-encoded — the one identity the
 * `--sovereign` leg has.
 *
 * ## Owner id, owner key and enrolment user key are deliberately the same value
 *
 * Not a shortcut: it is the *absence* of a second answer. `discoverCandidates` sets a
 * descriptor's `ownerId` to `certificate.userKey`; `ownRecords` (`fabric-node.ts`)
 * publishes `sovereignFor: [certificate.userKey]` and reads nothing else from a node's
 * clearance; `bin/agent.ts` refuses, exit 2 naming both, when a passed `--owner-id`
 * disagrees with its `--user-key`-derived key; and `fabric-node.ts` names the repository's
 * own fixture as dodging the two-answers problem *"by making the owner id be a hex key"*.
 * A second keypair here would be a second answer to a question that has one, and the
 * failure it produces is the one `bin/agent.ts` already recorded: *"a
 * `PlacementRequest.ownerId` holding an operator label therefore matched no
 * discovery-derived descriptor, and a sovereign shard came back `unplaceable` with nothing
 * anywhere obviously wrong."*
 *
 * ## Derived through `delegate`, and that is a COPY of a shape, not a de-duplication
 * candidate
 *
 * `packages/node/src/capability-fixture.ts`'s `publicKeyOf` is the same three lines and its
 * docblock carries the same argument: `delegate` computes the issuer's public key as part
 * of signing and is the only public-key derivation `@o2/core` exposes, so this needs no
 * `@noble/curves` — which is **not** a declared dependency of `@o2/node` and only resolves
 * in specs because the root install hoists it. It is also the identical derivation
 * `delegate` uses when it signs the chain below, so the root of a chain cannot disagree
 * with the key this driver pins.
 *
 * **That fixture must not be imported from `bin/`, and this copy is the price.** Its own
 * header says why: it is test-only and deliberately absent from the barrel *"so it exposes
 * no capability that Phase 22's reachability guard could trace to an entry point. A
 * barrel-exported fixture would hand that guard a real finding this phase invented."*
 * Importing it here would manufacture the exact finding this leg exists to remove. The two
 * are kept in step by hand; do not merge them.
 *
 * The throwaway delegation this derivation mints is never sent anywhere — it exists for
 * one field read off its own signature — which is why its owner id, audience and expiry
 * say so rather than pretending to be plausible values.
 */
const BENCH_OWNER_KEY: PublicKeyHex = delegate(BENCH_USER_SEED, {
  ownerId: 'derives-a-public-key-and-is-never-sent',
  audience: 'derives-a-public-key-and-is-never-sent',
  abilities: ['execute'],
  expiresAt: 1,
}).issuer

/**
 * AUTH-03's requestor half: the chain one candidate is dispatched under.
 *
 * ## A copy of a shape, and the import it refuses
 *
 * `capability-fixture.ts`'s `chainSupplierFor` and `directChainFor` are these same lines.
 * They are copied and not imported for the reason stated in full at {@link BENCH_OWNER_KEY}
 * — that module is test-only and is deliberately outside the barrel, and importing it from
 * a runnable entry point would manufacture the Phase 22 reachability finding this leg
 * exists to remove. **The two must be kept in step by hand.** A reader who does not know
 * that will merge them, which is why it is said at both ends.
 *
 * ## A function of the node id, and why that is not incidental
 *
 * `CandidateOptions.dispatch` takes a function *of the node id* returning the supplier,
 * because a chain's audience must be the node it is sent to: *"a chain minted for node A is
 * refused at node B with `wrong-audience`"*. One supplier shared across a candidate set can
 * name at most one audience. `audienceKeyOf` derives that key from the peer id, and it is
 * the identical derivation the serving node applies to its own `libp2p.peerId` — nothing is
 * exchanged to make the two agree.
 *
 * ## `[]` for anything not owner-labelled is not a stub
 *
 * A public task has no owner and therefore no key a chain could be rooted at, and
 * `authorizeCapability` returns `null` for one before it ever looks at a chain. The empty
 * return is the correct answer, not a missing case — which matters here because every shard
 * of every rung this driver measures takes exactly that branch.
 *
 * ## The expiry is a constraint, not a formality
 *
 * One hour, computed at call time rather than at module load so a slow run cannot expire a
 * chain minted for it. An unbounded delegation is the thing AUTH-03 exists to make
 * impossible: `verifyChain` checks it against the serving node's own clock, so a chain that
 * never expires is a standing grant to whoever holds it. One hour is a configuration choice
 * and not a measurement — it has to outlast one dispatch, and nothing here reads how long a
 * dispatch takes.
 */
function sovereignSupplierFor(nodeId: string): CapabilitySupplier {
  return (task: Task): readonly Delegation[] =>
    task.label === 'sovereign' && task.ownerId !== undefined
      ? [
          delegate(BENCH_USER_SEED, {
            ownerId: task.ownerId,
            expiresAt: Date.now() + 3_600_000,
            audience: audienceKeyOf(nodeId),
            abilities: ['execute'],
          }),
        ]
      : []
}

/** The TCP multiaddr a peer dials this node at, peer id included. */
function dialableAddr(node: FabricNode): string {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

/** The two levers `realFabric` exposes for BENCH-07 criterion 3. Both default to what the published curves ran. */
interface RealFabricOptions {
  /**
   * Which side opens the connections. Defaults to `'workers-to-submitter'`, which is what
   * this rig has always done and what **every published real-transport number was taken
   * under** — so an existing caller that omits it builds byte-identically to before.
   *
   * `Libp2pTransport.send` reaches a peer by peer id and reuses an existing connection
   * whichever end opened it, so flipping this changes only **which side receives** the
   * inbound connection, not how a dispatch arrives. That is what makes the direction
   * separable from the process split — and separating them is the whole of criterion 3,
   * since adopting the spawn pattern changed both at once and only one of them is what
   * BENCH-07 is about.
   */
  readonly dial?: DialDirection
  /**
   * The inbound rate limit pinned on the **submitting** node, or absent to let it derive
   * its own from the reservation limit.
   *
   * The submitting node is the one that receives every dial under
   * `'workers-to-submitter'`, so it is the only node a cap can be pinned on and be
   * exercised by that direction.
   */
  readonly inboundThreshold?: number
}

/**
 * N real libp2p nodes over TCP on loopback. Same machine — labelled as such.
 *
 * **The fixture is a parameter and defaults to the one the published curves ran.** The
 * in-process control for the speedup sweep is this rig on the saturating fixture: it
 * differs from the process-per-node rig in exactly one thing — where the nodes live — and
 * a control that differed in the fixture too would not be a control. Every existing
 * caller omits the argument and therefore builds byte-identically to what it built
 * before.
 *
 * ## This function releases what it started when it cannot finish
 *
 * Every `FabricNode` below is started before the rig that owns them is returned, so a
 * throw part-way through construction used to leave them running with nothing holding a
 * reference able to stop them. The cost was measured rather than reasoned about: a full run
 * whose 16-node rung threw wrote both report files, printed its closing line and then **did
 * not exit** — its event loop still holding the leaked nodes' handles — for 11 minutes 40
 * seconds before it was killed, and the same shape reproduced with a rung that threw
 * immediately after the requestor started, alive 202 s past its own report.
 *
 * The repair is a `try`/`finally` over the whole body with a hand-off flag, and it is
 * `finally` rather than `catch` for a stated reason: `bench-driver.node.test.ts` requires
 * every `catch (` in this file to be paired with a `HarnessIntegrityError` re-throw, and a
 * re-throw here would be a clause that can never fire — this function raises no such error.
 * A flag set on the last line before the return is what distinguishes a rig that was handed
 * to a caller, and is therefore that caller's to close, from one that never left.
 */
async function realFabric(
  nodes: number,
  fixture: FixtureKind = 'trivial',
  options: RealFabricOptions = {},
): Promise<Fabric> {
  const root = await mkdtemp(join(tmpdir(), 'o2-bench-'))
  const started: FabricNode[] = []
  const moduleBytes = moduleBytesFor(fixture)
  const moduleRecord = recordFor(fixture)
  const direction: DialDirection = options.dial ?? 'workers-to-submitter'
  /**
   * Whether the rig below reached a caller.
   *
   * `false` through the whole of construction, `true` on the line before the return. The
   * `finally` reads it and releases everything on the way out of a throw; on the success
   * path it releases nothing, because closing is then the caller's job and doing it here
   * would tear down the rig it just handed over.
   */
  let handedOver = false
  /**
   * The provider and the requestor, as each starts — the two nodes `started` does not hold.
   *
   * An array rather than two narrowed locals so {@link release} has one thing to walk, and
   * so a node that has started is releasable from the instant it exists rather than from
   * the end of the statement that names it.
   */
  const extra: FabricNode[] = []

  /** Stop everything this call started, in start order, and remove its directory. */
  const release = async (): Promise<void> => {
    // Tolerant of a node that has already left, so one failed stop cannot strand the rest —
    // the same disposition `close()` below takes for the same reason.
    for (const node of [...started, ...extra]) await node.stop().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }

  try {
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
      extra.push(provider)
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
          // AUTH-03 — the clearance the `--sovereign` leg dispatches into, and a spread for
          // the reason the `enrollment` spread above already gives: with
          // `exactOptionalPropertyTypes` an explicit `undefined` is a different thing from
          // an absent key, and on the default path this key must be **absent** so a worker
          // is built byte-identically to what it was before this leg existed.
          //
          // Three fields, each with a different consumer, so none of them is decoration:
          //
          // - `ownerId` is what `authorizeCapability` compares a task's owner against, and
          //   what `guardSovereignty` checks this node's clearance for. They refuse for
          //   different reasons at different points; both read this string.
          // - `ownerKey` is the root `verifyChain` verifies a chain against. **Without it
          //   every sovereign task is refused before clearance is even consulted** — that
          //   is `authorizeCapability`'s rule 2, and it is the refusal a requestor observes
          //   first, because `authorize` runs before `execute`.
          // - `canExecuteSovereign` is the only field `ownRecords` reads from this record,
          //   and it is what puts `certificate.userKey` into the published `sovereignFor`
          //   list that `discoverCandidates` reads back as the descriptor's clearance. All
          //   three values are one string here — see `BENCH_OWNER_KEY` for why a second
          //   would be a second answer to a question that has one.
          //
          // This is a per-node clearance and **not a node class**: every node this driver
          // builds has identical capability, and what differs is the value it was
          // configured with — the sentence `FabricNodeOptions.sovereignty` already carries.
          ...(SOVEREIGN
            ? {
                sovereignty: {
                  ownerId: BENCH_OWNER_KEY,
                  canExecuteSovereign: true,
                  ownerKey: BENCH_OWNER_KEY,
                },
              }
            : {}),
        }),
      )
    }

    // **The falsifier for the whole `--sovereign` mechanism, and it is checked against the
    // fabric rather than trusted.**
    //
    // `BENCH_OWNER_KEY` is derived locally, from a seed, by a different code path from the
    // one `requestEnrollment` uses to compute `userKey` — that one is
    // `toHex(ed25519.getPublicKey(userPrivateKey))`. Four call sites downstream have to
    // agree on that one string: the descriptor's `ownerId`, the published `sovereignFor`
    // list, `guardSovereignty`'s clearance and `authorizeCapability`'s pinned owner. A
    // derivation wrong by one byte satisfies none of them and satisfies them **quietly** —
    // the shard becomes `unplaceable`, the leg reports a zero, and there is nothing
    // anywhere obviously wrong. So the two are compared here, at the one moment both
    // exist, and a disagreement stops the run naming both keys.
    //
    // Read off `started[0]` and not off every worker: they all enrol under the same seed
    // with the same provider, so the first is the reading and a loop would be N copies of
    // one comparison.
    if (SOVEREIGN) {
      const witness = started[0]
      if (witness?.certificate == null) {
        throw new Error(
          '--sovereign: no worker holds a certificate, so no descriptor can carry an owner —' +
            ' the enrolment the discover arm performs is what this leg rides',
        )
      }
      if (witness.certificate.userKey !== BENCH_OWNER_KEY) {
        throw new Error(
          `--sovereign: the derived owner key ${BENCH_OWNER_KEY} is not the key a worker enrolled` +
            ` under (${witness.certificate.userKey}); every sovereign shard would be unplaceable`,
        )
      }
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
      // BENCH-07 criterion 3, and absent unless a caller pinned it — which is every caller
      // that produced a published figure. This is the node that receives every dial under
      // the default direction, so it is the only one a pinned cap could be exercised by.
      ...(options.inboundThreshold === undefined
        ? {}
        : { inboundConnectionThreshold: options.inboundThreshold }),
    })
    extra.push(requestor)
    const moduleCid = sameFixtureCid(
      'realFabric',
      await requestor.store.put(moduleBytes),
      moduleRecord.cid,
    )

    // **Which side opens the connections — a parameter since Plan 23-04, defaulting to what
    // every published number was taken under.**
    //
    // Under `workers-to-submitter` everyone dials the requestor, so blocks are reachable
    // from every worker and the requestor is the node receiving N connections from one host.
    // Under `submitter-to-workers` the requestor dials outward instead, which is what the
    // process-per-node rig does by default. A dispatch arrives identically either way:
    // `Libp2pTransport.send` reaches a peer by peer id and reuses an existing connection
    // whichever end opened it, so this switch changes **who accepts** and nothing else.
    if (direction === 'workers-to-submitter') {
      for (const node of started) {
        await node.libp2p.dial(requestor.libp2p.getMultiaddrs())
      }
    } else {
      for (const node of started) {
        await requestor.libp2p.dial(node.libp2p.getMultiaddrs())
      }
    }

    // AUTH-03 — the **default** arm's executor set, and the sentinel is the correct value
    // on it for the reason it always was: every shard placed against these descriptors is
    // public, and `publicNodes` below hardcodes an owner id of `'public'`, so nothing here
    // could name an owner even if a shard did.
    //
    // These two lines are what `--discover` replaces and what `--sovereign` therefore never
    // reaches: the sovereign leg rides the discovered set, which carries an owner id read
    // off a signed certificate. Both are reassigned below rather than shadowed, so a
    // reader can see there is one executor set and one descriptor set per rig.
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
      for (const node of started) await node.store.put(moduleBytes)

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
          // AUTH-03 — **one argument, and it is the whole supplier half.** Every
          // `RemoteExecutor` this helper builds inherits what is written here, which is why
          // the sovereign leg adds no construction of its own.
          //
          // **The comment that stood here said the sentinel was permanent because every
          // shard this driver submits is public. That ground is now false on one arm**, and
          // a comment left standing beside code contradicting it is exactly the decoration
          // `serve-agent-hooks.node.test.ts` exists to prevent. What is true instead: the
          // sentinel is what the **default** arm writes down, and it is still the correct
          // value there for the unchanged reason — a public task has no owner, so there is
          // no key a chain could be rooted at and a chain would be a per-dispatch cost on a
          // branch that can never refuse. The `--sovereign` arm is the other branch of this
          // one ternary, at this one site.
          dispatch: SOVEREIGN ? sovereignSupplierFor : 'dispatches-unauthenticated',
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

      // ── the --sovereign leg ────────────────────────────────────────────────────────────
      //
      // AUTH-03's requestor half, given a caller. One owner-labelled shard, dispatched
      // through the executors `discoverCandidates` just built, each carrying the chain
      // `sovereignSupplierFor` mints for it. Everything here is inside `if (DISCOVER)` and
      // inside `if (SOVEREIGN)`, so a default run reaches none of it.
      //
      // ## Why this is its own job and not one relabelled shard of the sweeps
      //
      // The plan for this leg put the owner-labelled shard at `runnerOver`'s submit site,
      // beside the fifteen public ones. **Two measured facts refuse that**, and both were
      // read from source rather than reasoned about:
      //
      // 1. That site is shared by every rig. `memoryFabric` builds its descriptors with
      //    `publicNodes`, which hardcodes an `ownerId` of `'public'`, so `eligibleNodes`
      //    matches nothing for an owner-labelled shard and the shard is `unplaceable`. The
      //    memory sweeps run before the first real rig, so the driver would have failed
      //    there — on the arm the leg is not about — before this one was ever built.
      // 2. `submitJobWithEgress` registers every sovereign shard's canonical bytes on every
      //    guard it is handed, for the job's duration (DATA-10). This requestor is the block
      //    source for every worker, so an owner-labelled row the owner does not already hold
      //    cannot reach it: the response frame carries the registered bytes and the guard
      //    refuses it. That is the mechanism working, not failing — a sovereign row is
      //    owner-pinned by construction — and it means the leg has to seed the owner's own
      //    node with its own row **before** dispatching, which is only possible where the
      //    nodes are built. Which is here.
      //
      // ## The trivial fixture only, and that is a scope statement
      //
      // The saturating rig's shards all carry one identical value, so seeding it would put
      // the control sweep's own input into every worker's store and move what that sweep
      // measures. The dispatch path this leg is about is identical on both fixtures, so
      // nothing is lost by running it on one. Named here so it is a scheduled absence
      // rather than an oversight.
      if (SOVEREIGN && fixture === 'trivial') {
        // Distinct from every value `shardInputs` produces, deliberately: the sweeps that
        // follow must fetch their own inputs exactly as they always have, and a row seeded
        // into the workers below that happened to be one of theirs would remove a fetch from
        // the measured path.
        const row: CanonicalValue = { partition: 0, payload: new Uint8Array(16).fill(0x5e) }
        const encoded = await canonicalCid(row)
        if (!encoded.ok) {
          throw new Error(`--sovereign: the owner-labelled row would not encode: ${encoded.error}`)
        }

        // **The row is resident on the owner's own node before anything is dispatched**,
        // which is what "sovereign" means in this fabric and what `sovereign-egress.ts`
        // states as its premise. It is also what makes the dispatch possible at all — see
        // fact 2 above — and what lets the worker take its own hold on the row while it
        // executes over it.
        for (const node of started) await node.store.put(encoded.bytes)

        const legStarted = performance.now()
        const dispatched = await submitJobWithEgress(
          {
            moduleCid,
            moduleRecord,
            // Exactly one, and the count is the point rather than a sample size. This leg
            // exists to give `delegate` a caller, not to change what the fixture measures,
            // and the reading it produces — did a real chain, verified by a real node
            // against a pinned key, admit a real dispatch — is answered as completely by one
            // shard as by sixteen.
            shards: [{ value: row, label: 'sovereign' as const, ownerId: BENCH_OWNER_KEY }],
            executors,
            nodes: descriptors,
            // 1, and it is the honest figure rather than a weakened one: every worker in
            // this rig enrols under one user key, so they are one owner's nodes, and a
            // sovereign shard is owner-attested by construction — pinning data to one owner
            // removes the second independent executor. `PROJECT.md` splits the verification
            // claim on exactly this line.
            redundancy: 1,
            onQuorumShortfall: 'runs-at-available-redundancy',
          },
          requestor.store,
          [requestor.egress],
          { checkpoints: 'checkpoints-nothing' },
        )
        const legMs = performance.now() - legStarted

        const shard = dispatched.ok ? dispatched.job.shards[0] : undefined
        const agreed = shard?.verification.status === 'agreed' ? 1 : 0
        process.stdout.write(
          `--sovereign: ${String(agreed)} of 1 sovereign shards agreed,` +
            ` chain rooted at ${BENCH_OWNER_KEY.slice(0, 8)},` +
            ` audience ${shard === undefined || shard.attempted.length === 0 ? 'nobody' : shard.attempted.join('/')}\n`,
        )

        // **A throw and never a reported zero**, and the reason is the failure mode this
        // whole criterion is about: a leg printing `0 of 1` is indistinguishable from a leg
        // that was never wired, and both look like a line that ran. So the run stops, and it
        // stops carrying what the fabric said — the shard's own status, the reason on the
        // arm that has one, and each node's refusal in its own words, which is where a
        // chain the worker rejected arrives (`unauthorized: …`, prefixed by `agent.ts` and
        // worded by `describeFailure`).
        if (agreed === 0) {
          const said =
            shard === undefined
              ? `submit refused: ${dispatched.ok ? 'no shard returned' : dispatched.error.kind}`
              : `${shard.verification.status}` +
                `${shard.verification.status === 'insufficient' ? `: ${shard.verification.reason}` : ''}` +
                `${
                  shard.verification.status === 'agreed'
                    ? ''
                    : shard.verification.failures
                        .map((failure) => `; ${failure.nodeId}: ${failure.reason}`)
                        .join('')
                }`
          throw new Error(
            `--sovereign: the owner-labelled shard did not agree (${said}) after` +
              ` ${legMs.toFixed(0)} ms; refusing to report a leg that dispatched nothing`,
          )
        }
      }
    }

    const fabric: Fabric = {
      executors,
      nodes: descriptors,
      // No cast. The seam's `blockstore` is `Blockstore`, which this store is — the
      // `as unknown as MemoryBlockstore` that stood here was the cost of a second,
      // narrower declaration of the same interface in this file.
      blockstore: requestor.store,
      moduleCid,
      moduleRecord,
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
      // BENCH-07 criterion 3 — the two inbound limits this node ended up with, and how many
      // connections it is holding, read off the live node at the moment of the call. A
      // caller that published the value it passed instead of the value the node derived
      // would restate, at the reporting layer, the exact defect the excluded row's stored
      // paragraph was.
      submitterReading: () => ({
        inboundConnectionThreshold: requestor.inboundConnectionThreshold,
        maxIncomingPendingConnections: requestor.maxIncomingPendingConnections,
        connections: requestor.libp2p.getConnections().length,
      }),
      // `release` and not a second loop of its own. The loop that stood here walked
      // `[...started, requestor]` and therefore **never stopped the provider** — a
      // `--discover` run leaked one node per rig, silently, in the same class as the
      // construction leak the `finally` below repairs. One releaser, walked from one list,
      // is what makes that a single place to get right.
      close: release,
    }
    // The last line before the hand-off, and the only place this is set. Everything above
    // may throw; from here on the rig is the caller's and `finally` must not touch it.
    handedOver = true
    return fabric
  } finally {
    if (!handedOver) await release()
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
  /**
   * How many of this job's owners contributed — CHURN-05, criterion 4.
   *
   * Recorded on the **same record and in the same statement** as the two receipts above,
   * for that statement's own stated reason: a reader comparing a coverage denominator
   * against an attestation strength must be comparing two facts about one job.
   *
   * Every rung of this driver submits `label: 'public'` shards, so this is the named
   * sentinel on every rung of every run — which is exactly why it is *carried* rather than
   * rendered unconditionally. See {@link coverageReading}.
   *
   * **Still every rung, including under `--sovereign`.** That leg submits its one
   * owner-labelled shard as a job of its own, during rig construction and outside every
   * measured region, so no rung's `JobResult` ever carries an owner and this field's
   * reading does not move. See the leg in `realFabric` for why it is a separate job.
   */
  readonly coverage: JobResult['coverage']
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

/**
 * How many of one rung's owners contributed — CHURN-05, criterion 4's CLI half.
 *
 * ## The decision this function is, written down because it had to be made either way
 *
 * **A coverage line is printed only where the job defines owners, so the line's presence
 * is itself the information.** Every rung of this driver submits `label: 'public'` shards
 * — `shards.map((value) => ({ value, label: 'public' as const }))` at the **measured**
 * submit site, which is the only site any rung reaches
 * — so `JobResult.coverage` is the named sentinel on **every rung of every run**, and this
 * function returns `null` for all of them. That is the decision, not a gap: a line
 * repeating *"this job defines no owners"* five times per sweep is noise a reader learns
 * to skip, and a reader who has learned to skip a line cannot be told anything by it.
 *
 * **The alternative was to print nothing at all here**, and it was rejected for one
 * reason: it leaves the CLI with no reader for the failure below, and that failure is the
 * one 20-08's named union exists to prevent.
 *
 * ## What must not happen, and what holds it
 *
 * `coverageOf` treats an empty owner set as **not** complete — *"An empty job is not a
 * complete one — '0 of 0 owners' answers nothing"* — so a bare `CoverageReport` on a
 * public job renders `covered: 0/0 owners — PARTIAL (no owners were expected)`. Ship that
 * and **every rung of every published sweep prints PARTIAL**, apologising for a question
 * it was never entered for. The named arm below is the only thing between this stream and
 * that sentence, and `packages/node/src/coverage-agents.node.test.ts` reads this driver's
 * own stdout to say so: no rung prints `PARTIAL`, and no rung prints `covered:`.
 *
 * That reading is an *absence*, so it is paired there with a source-text count of this
 * function's call site — otherwise deleting the renderer would satisfy it. Neither half is
 * worth much alone; the pair is what makes the silence a measurement.
 *
 * ## Where criterion 4's rendered reading actually lives
 *
 * Not here. A `covered: 2/3 owners` line off a live cross-owner job with one owner's node
 * stopped is in `coverage-agents.node.test.ts`, over spawned `bin/agent.ts` processes,
 * because no rung of this driver runs a sovereign shard and no rung therefore has an owner
 * to be missing. **The `--sovereign` leg does not change that and is not a second reading
 * of it**: its job names one owner and every node in the rig belongs to that owner, so its
 * coverage would be complete by construction — a denominator of one, answered by the one
 * node that could ever have answered it. Coverage is a question about *several* owners, and
 * the file above is where several exist.
 * Same division as the speculation columns above: the CLI leg establishes that the surface
 * is wired, the process fixture establishes what it says when it has something to say.
 *
 * `null` when this rung returned no job at all, for {@link aggregateReading}'s reason: a
 * rung that ran nothing has no coverage, and printing a denominator for it would be a
 * statement about a job that did not happen.
 */
function coverageReading(held: RungAttestation | NoJobToAttest): string | null {
  if (held === 'no-run-of-this-rung-returned-a-job') return null
  const { coverage } = held
  // The named arm, handled before `describeCoverage` is reachable at all — the shape
  // 20-08 built the union to force on every display site. Deleting this line does not
  // fail to compile; it changes what five rungs print.
  if (coverage === 'defines-no-owners') return null
  return describeCoverage(coverage)
}

/**
 * What one rung reported about the fixture it ran, over and above its makespan.
 *
 * Read off the rung's **first measured run** — the first iteration `measure` keeps, i.e.
 * the first `warm` one, since it treats iteration 0 as a cold start and excludes it from
 * the population `makespan` is summarised over. Following that rule rather than inventing
 * one is what keeps this reading from coming off a population the published statistics do
 * not contain.
 */
interface RungReadings {
  /** One status per shard, as plain strings. Empty on a trivial-fixture rung. */
  readonly statuses: readonly string[]
  /** {@link CostAccumulator.calls} — dispatch-to-response intervals, which overlap. */
  readonly calls: readonly number[]
  /** `ShardResult.generations` per shard. `1` is a shard that never had to retry. */
  readonly generations: readonly number[]
  /** `ShardResult.speculated` per shard — whether a duplicate was started for it. */
  readonly speculated: readonly boolean[]
  /** The module CID this rung's fabric was handed, as a string. */
  readonly moduleCid: string
  /**
   * Gross node-seconds accumulated across **every** run of this rung, in milliseconds.
   *
   * This is the denominator of the driver-CPU share, and it is a **proxy**: gross
   * node-seconds is wall time inside each executor call, not CPU time, so on a genuine
   * multi-process run it includes network wait. The denominator is therefore not a CPU
   * measurement. That much is said and no more — what the share comes to is measured and
   * published beside each rung.
   */
  readonly computeMs: number
}

/** The accumulating form. {@link RungReadings} is what a caller sees. */
interface MutableRungReadings {
  statuses: readonly string[]
  calls: readonly number[]
  generations: readonly number[]
  speculated: readonly boolean[]
  moduleCid: string
  computeMs: number
  captured: boolean
}

/** Everything a runner accumulates across the runs it drives, shared by both runners. */
interface RunnerState {
  egressEntries: number
  egressBytes: number
  readonly attestations: Map<number, RungAttestation>
  readonly readings: Map<number, MutableRungReadings>
}

function newRunnerState(): RunnerState {
  return { egressEntries: 0, egressBytes: 0, attestations: new Map(), readings: new Map() }
}

/**
 * The measured job path, written once and shared by every driver.
 *
 * **One body, deliberately.** The speedup comparison is between two drivers running the
 * identical job, and a second copy of this function would let the two paths drift with
 * nothing able to catch it — at which point the ratio is measuring the copy. The drivers
 * differ only in `acquire`: one caches a fabric per node count, the other holds one at a
 * time and disposes the previous.
 */
function runnerOver(acquire: (nodes: number) => Promise<Fabric>, state: RunnerState): JobRunner {
  return async (config, codeCache) => {
    const fabric = await acquire(config.nodes)

    const cost: CostAccumulator = { gross: 0, perNode: new Map<string, number>(), calls: [] }
    const executors = fabric.executors.map((executor) => timed(executor, cost))
    const shards = await shardInputs(config.skew, config.fixture)

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
      {
        // CHURN-03. Same as `perf-workload.ts`: this is a driver whose output is a
        // reading, and a checkpoint that let a later run skip shards would corrupt the
        // makespan it exists to measure.
        //
        // **This is *not* the cheapest place to close criterion 7's write half, and the
        // first version of this comment said it was.** The claim was that this process
        // holds a `blockstoreDir` that outlives it. It does not: `realFabric` builds the
        // requestor's store under `mkdtemp(tmpdir(), 'o2-bench-')` and `close()` ends with
        // `rm(root, { recursive: true, force: true })`, so the directory and every block in
        // it are deleted when the run ends. A handle published from here would name a block
        // that no longer exists by the time anything could resume from it.
        checkpoints: 'checkpoints-nothing',
      },
    )
    const makespanMs = performance.now() - started

    if (result.ok) {
      // Exactly one guard was supplied above, so exactly one manifest comes back —
      // still read defensively rather than asserted, per `noUncheckedIndexedAccess`.
      const manifest = result.manifests[0]
      if (manifest !== undefined) {
        state.egressEntries += manifest.entries.length
        state.egressBytes += manifest.totalBytes
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
    // **The reduce leg runs on the trivial fixture only, and the named absence above is
    // the truthful reading of a saturating rung rather than a skipped step.** `project`
    // decodes a `{p: <4 LE bytes>}` output, which is what the trivial module emits; the
    // colouring kernel emits a packed field and a status byte, so the projection throws on
    // it. Giving the saturating arm its own projection was measured and rejected rather
    // than assumed: every one of its sixteen shards ends on the same status with an
    // all-zero field — that is condition 1 of `SATURATING_N`, so it is the fixture working
    // — so a projection over the output alone yields sixteen identical leaves, and
    // `deriveReduceTree` dedupes on contributor and cid. The tree would collapse, and
    // `treeDepth` would move for a reason with nothing to do with the fabric. The only way
    // back to distinct leaves is to key on the partition index, which is the substitution
    // `project`'s own docblock exists to refuse.
    //
    // The speedup sweeps ask a makespan question and the reduce table is rendered from
    // the two trivial curves, which are unaffected.
    if (result.ok && config.fixture === 'trivial') {
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
      const held = state.attestations.get(config.nodes)
      if (held === undefined || (complete && !held.fromCompletedRun)) {
        state.attestations.set(config.nodes, {
          attestation: result.job.attestation,
          aggregate,
          // CHURN-05, in the same statement as the two receipts and for the same reason.
          coverage: result.job.coverage,
          fromCompletedRun: complete,
        })
      }
    }

    // The fixture instruments — BENCH-07 criterion 1's third and fourth readings, plus
    // the two confound vectors criterion 2's ratio is meaningless without.
    //
    // Accumulated on **every** run, captured on the **first measured** one. `measure`
    // treats iteration 0 as a cold start and drops it from the population it summarises
    // `makespan` over, so the vector is read off the same population the published
    // figures come from rather than off a run they exclude.
    const rung = state.readings.get(config.nodes) ?? {
      statuses: [],
      calls: [],
      generations: [],
      speculated: [],
      moduleCid: fabric.moduleCid.toString(),
      computeMs: 0,
      captured: false,
    }
    rung.computeMs += cost.gross * 1000
    if (!rung.captured && codeCache === 'warm' && result.ok) {
      rung.captured = true
      rung.calls = [...cost.calls]
      rung.generations = result.job.shards.map((shard) => shard.generations)
      rung.speculated = result.job.shards.map((shard) => shard.speculated)
      // `readPartial` throws on an output that is not a colouring partial, which is
      // every output the trivial module produces — so the status vector exists only
      // where there is a fixture whose statuses mean something. A trivial rung's empty
      // vector is never handed to `fixtureUniformityViolations`, which reports an empty
      // vector as an unread instrument, correctly.
      rung.statuses =
        config.fixture === 'saturating'
          ? result.job.shards.map((shard) =>
              shard.verification.status === 'agreed'
                ? readPartial(shard.verification.output).status
                : `did-not-agree:${shard.verification.status}`,
            )
          : []
    }
    state.readings.set(config.nodes, rung)

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
      // **Both read from the job that just returned**, since 20-09. Neither was until
      // then: both were literals with a comment saying so, and both columns printed those
      // values whatever the job did. `redispatches` has been real on this path since 20-01
      // — a shard whose lease lapses is re-placed and `JobResult.redispatches` counts the
      // generations beyond the first — and `speculationMultiplier` since 20-07, which gave
      // `submitJob` straggler duplication and a `SpeculationLedger` to count it with.
      //
      // **A run in which nothing straggled still prints 1.00, and that is now a
      // measurement rather than the identity.** The distinction is invisible in the number
      // and is therefore stated here, which is the same care the comment this replaced
      // took in the other direction. What separates the two in the data is
      // `JobResult.speculationSpent` — `0` on a job that duplicated nothing — and it is
      // deliberately not folded into either column, because a column that quietly means
      // two things is what the pair of sentences above exists to prevent. The live reading
      // of a duplicate actually firing lives in
      // `packages/node/src/speculation-agents.node.test.ts`, which is also where these two
      // call sites are guarded against reverting to constants.
      //
      // `0` on the not-ok arm follows `verificationMultiplier` above: a submission that
      // was refused ran no job, so there is no measurement — and `SpeculationLedger`
      // itself reports `0` for a job of zero tasks, so the two agree.
      speculationMultiplier: result.ok ? result.job.speculationMultiplier : 0,
      redispatches: result.ok ? result.job.redispatches : 0,
      codeCache,
      reduce,
    } satisfies Observation
  }
}

/** The finished readings for one rung, or `undefined` where no run of it was captured. */
function readingsOf(state: RunnerState, nodes: number): RungReadings | undefined {
  const held = state.readings.get(nodes)
  if (held === undefined) return undefined
  return {
    statuses: held.statuses,
    calls: held.calls,
    generations: held.generations,
    speculated: held.speculated,
    moduleCid: held.moduleCid,
    computeMs: held.computeMs,
  }
}

/**
 * Egress recorded across every run an instance has driven so far, read off
 * `Fabric.guard` via `submitJobWithEgress` rather than the bare `submitJob` this driver
 * used to call — DATA-05/DATA-06's manifest, reachable from the entry point itself, not
 * only from a test harness that constructs its own guard.
 */
interface Runner {
  run: JobRunner
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
  /** The fixture and confound readings for one rung. See {@link RungReadings}. */
  readingsFor: (nodes: number) => RungReadings | undefined
  dispose: () => Promise<void>
}

/** Build a runner that reuses one fabric per node count across all iterations. */
function runnerFor(build: (nodes: number) => Promise<Fabric>): Runner {
  const fabrics = new Map<number, Fabric>()
  const state = newRunnerState()

  // Left exactly as it was for the memory and real legs: their published numbers were
  // taken with every rung's fabric still resident, and changing that would change what
  // those curves are comparable with.
  const acquire = async (nodes: number): Promise<Fabric> => {
    let fabric = fabrics.get(nodes)
    if (fabric === undefined) {
      fabric = await build(nodes)
      fabrics.set(nodes, fabric)
    }
    return fabric
  }

  return {
    run: runnerOver(acquire, state),
    egressTotals: () => ({ entries: state.egressEntries, bytes: state.egressBytes }),
    attestationFor: (nodes) => state.attestations.get(nodes) ?? 'no-run-of-this-rung-returned-a-job',
    readingsFor: (nodes) => readingsOf(state, nodes),
    dispose: async () => {
      for (const fabric of fabrics.values()) await fabric.close()
      fabrics.clear()
    },
  }
}

/** A {@link Runner} that also surfaces the live rig, which the identity readings need. */
interface ProcessRunner extends Runner {
  /** The rung's fabric while it is still up, or `undefined` once it was disposed. */
  fabricFor: (nodes: number) => ProcessFabric | undefined
}

/**
 * Build a runner that holds **one** fabric at a time and disposes the previous rung's.
 *
 * Beside {@link runnerFor} rather than an option on it, because the difference is
 * behavioural and it is the whole reason this exists. `runnerFor` caches a fabric per
 * node count and disposes them all at the end; under a process driver that leaves every
 * earlier rung's agents resident while the last rung is measured — idle, but each holding
 * a libp2p node and a heap, and each contending for the CPU being measured. How many that
 * is at the top of the ladder is a quantity to read off the process table the run
 * publishes, not one to settle here.
 */
function processRunnerFor(build: (nodes: number) => Promise<ProcessFabric>): ProcessRunner {
  const state = newRunnerState()
  let held: { nodes: number; fabric: ProcessFabric } | undefined

  const acquire = async (nodes: number): Promise<Fabric> => {
    if (held !== undefined && held.nodes !== nodes) {
      await held.fabric.close()
      held = undefined
    }
    if (held === undefined) held = { nodes, fabric: await build(nodes) }
    return held.fabric
  }

  return {
    run: runnerOver(acquire, state),
    egressTotals: () => ({ entries: state.egressEntries, bytes: state.egressBytes }),
    attestationFor: (nodes) => state.attestations.get(nodes) ?? 'no-run-of-this-rung-returned-a-job',
    readingsFor: (nodes) => readingsOf(state, nodes),
    fabricFor: (nodes) => (held?.nodes === nodes ? held.fabric : undefined),
    dispose: async () => {
      if (held !== undefined) await held.fabric.close()
      held = undefined
    },
  }
}

/**
 * The four readings, concatenated, and the one place a rung's verdict is acted on.
 *
 * **One consumer, and its deletion is one line.** Four inline `if (list.length > 0)
 * throw` branches would look the same to a source-text guard — which is the only kind of
 * guard this repository can put over this file, because `main()` runs on import — and a
 * guard that matches identifiers cannot tell a checker that was called and read from one
 * that was called and discarded. The property comes from there being exactly one place
 * that reads all four.
 *
 * **The error raised here must not become an excluded row.** An excluded row says *this
 * configuration could not be measured*; this says *the measurement that came back is not
 * of the thing it claims*, and the two demand opposite responses. Every `catch` in this
 * file therefore re-throws it, and `bench-driver.node.test.ts` holds that as a count
 * equality rather than as a presence pattern, because a presence pattern can only prove
 * that one catch behaves.
 *
 * `identity` and `cpu` are absent on the in-process control: there are no child processes
 * to identify, and the control's work *is* in the driver by construction, so a ceiling on
 * the driver's share would be a check on the definition. Its share is measured and
 * published as a figure instead. Checks 3 and 4 run on **both** drivers — if the control
 * were quietly handed the trivial module it would produce a fast, flat curve, the ratio
 * against it would look like a large speedup, and the word `saturating` would be printed
 * beside it.
 */
function gateRung(
  at: string,
  observed: {
    readonly identity?: ProcessIdentity
    readonly cpu?: CpuAttribution
    readonly statuses: readonly string[]
    readonly declared: FixtureKind
    readonly moduleCid: string
  },
): void {
  const identity =
    observed.identity === undefined ? [] : processIdentityViolations(observed.identity)
  const cpu = observed.cpu === undefined ? [] : cpuAttributionViolations(observed.cpu)
  const uniformity = fixtureUniformityViolations({
    statuses: observed.statuses,
    // Sixteen, read from the constant this driver dispatches with. Never eight — that
    // figure belongs to a partition count this phase does not run.
    shards: SHARDS,
    expected: 'budget',
  })
  const provenance = fixtureProvenanceViolations({
    declared: observed.declared,
    moduleCid: observed.moduleCid,
    expected: FIXTURE_CIDS,
  })
  assertIntegrity(at, [...identity, ...cpu, ...uniformity, ...provenance])
}

/**
 * Sixteen per-shard durations, measured **one call in flight at a time**.
 *
 * This is where the published ideal bound comes from, and the reason it cannot come from
 * the measured job is stated on {@link CostAccumulator}: `submitJob` dispatches a
 * generation concurrently, so `timed`'s intervals overlap and their sum is not a serial
 * total. Awaiting each call here makes the driver-side clock a per-shard clock by
 * construction.
 *
 * Two properties make it the right instrument. **Exactly one call is in flight at a
 * time**, so each measurement is that shard's own duration and nothing else's. And
 * `partitionCount` stays `SHARDS`, so each call is the same work the job's shard does.
 *
 * What each measurement includes that a shard's own execution does not: **one RPC round
 * trip on top of the shard**. No estimate of it is subtracted and no derivation of which
 * way it moves the quotient is written here. The module block is already resident at the
 * agent from the rung's measured runs, so this measures compute rather than first fetch.
 *
 * ## Every call is checked, and the check is not decoration
 *
 * `Executor.execute` reports failure by **returning** `{ok: false, reason}` and never by
 * throwing, so a loop that discards the outcome cannot tell a shard that ran from a shard
 * that was refused — and a refusal is fast, which biases the quotient downward without
 * changing its shape. Measured on 2026-08-05: with the `label` below absent, all sixteen
 * calls came back `malformed request` in 1.2–4.3 ms each, against the ~90 ms the same
 * shard costs in the rung's own dispatch intervals, and a bound of `8.71×` was published
 * off sixteen refusal round trips. **The label is required at the wire even though it is
 * optional on `Task`** — `parseRequest`'s exec branch refuses a frame carrying neither
 * `public` nor `sovereign`, so an unlabelled task cannot reach `guardSovereignty` as a
 * no-op. So this function now states the label and refuses to return a vector at all if
 * any call did not run: a bound derived from calls that were refused is not a bound, and
 * the failure has to be loud because its symptom is a plausible number.
 */
async function calibratePerShard(fabric: ProcessFabric): Promise<readonly number[]> {
  const executor = fabric.executors[0]
  if (executor === undefined) {
    throw new Error(
      'the 1-node process-per-node rung exposed no executor, so there is nothing to calibrate ' +
        'against — an empty executor list at that rung is itself an integrity failure',
    )
  }
  const encoded = await canonicalCid(buildInput(SATURATING_N, DEFAULT_BUDGET))
  if (!encoded.ok) throw new Error('the saturating fixture input is not encodable')
  await fabric.blockstore.put(encoded.bytes)

  const perShard: number[] = []
  for (let partitionIndex = 0; partitionIndex < SHARDS; partitionIndex++) {
    const at = performance.now()
    const outcome = await executor.execute({
      moduleCid: fabric.moduleCid,
      moduleRecord: SATURATING_RECORD,
      inputCid: encoded.cid,
      partitionIndex,
      partitionCount: SHARDS,
      // Stated, not defaulted. `Task.label` is optional in process and **required at the
      // wire**; every shard this driver dispatches is `public`, and so is this one.
      label: 'public',
    })
    const elapsed = performance.now() - at
    if (!outcome.ok) {
      throw new Error(
        `the serial calibration's shard ${partitionIndex} of ${SHARDS} did not run: ${outcome.reason}. ` +
          'The ideal bound is sum ÷ max over these durations, so a refused call publishes a ' +
          'round trip as a shard cost — refusing here is the only way that stays visible.',
      )
    }
    perShard.push(elapsed)
  }
  return perShard
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
  // The COST denominator and the single-threaded baseline stay defined against the
  // trivial fixture, which is what every published crossover figure was measured on.
  const inputs = await shardInputs('uniform', 'trivial')

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
  const moduleCid = sameFixtureCid(
    'wasmInProcess',
    await store.put(MODULE_WRITES_PARTITION),
    FIXTURE_MODULE_CID,
  )
  // DET-03 — guarded, and this is the leg it would have been most tempting to skip.
  // This baseline exists to be compared against the two fabrics; if they pay for the
  // signature check and it does not, every reported speedup is inflated by exactly the
  // difference. A baseline measuring a cheaper path than the thing it is the baseline
  // for is not a baseline.
  const executor = guarded(new WasmExecutor({ nodeId: 'local', blockstore: store }))
  const inputs = await shardInputs('uniform', 'trivial')

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

/** One rung of one speedup sweep, in the terms the report publishes it in. */
interface SpeedupRung {
  readonly driver: DriverKind
  readonly nodes: number
  readonly p50: number
  readonly incomplete: number
  /** `process.cpuUsage()` delta across this rung's measured runs, in milliseconds. */
  readonly driverCpuMs: number
  /** Gross node-seconds × 1000. A proxy — see {@link RungReadings.computeMs}. */
  readonly shardComputeMs: number
  readonly cpuShare: number
  /**
   * The three mechanisms that could have produced a ratio without parallelism.
   *
   * `redispatches` and `speculationMultiplier` are read off `SweepResult.cost`, where
   * they have shipped since 20-01 and 20-07 and are already rendered as `churn/task` and
   * `spec. tax`; they are surfaced here beside the ratio rather than added. The two
   * vectors are new: `placeAgain` sits inside an unconditional generation loop bounded
   * only by `DEFAULT_MAX_GENERATIONS`, and `speculativeCandidates` does not read
   * redundancy at all, so neither is switched off by `redundancy: 1`.
   */
  readonly generations: readonly number[]
  readonly speculated: readonly boolean[]
  readonly redispatches: number
  readonly speculationMultiplier: number
  /** Dispatch-to-response intervals, which overlap. See {@link CostAccumulator}. */
  readonly calls: readonly number[]
}

/** One rung of the process table — what was observed, not what was expected. */
interface ProcessRow {
  readonly nodes: number
  readonly pids: readonly number[]
  readonly observed: number
}

function rungOf(
  driver: DriverKind,
  nodes: number,
  measured: SweepResult,
  readings: RungReadings,
  driverCpuMs: number,
): SpeedupRung {
  return {
    driver,
    nodes,
    p50: measured.makespan.p50,
    incomplete: measured.incomplete,
    driverCpuMs,
    shardComputeMs: readings.computeMs,
    cpuShare: readings.computeMs > 0 ? driverCpuMs / readings.computeMs : Number.NaN,
    generations: readings.generations,
    speculated: readings.speculated,
    redispatches: measured.cost.churnTax,
    speculationMultiplier: measured.cost.speculationTax,
    calls: readings.calls,
  }
}

/**
 * The process table — BENCH-07 criterion 1, rendered where a reader of the published
 * report will find it.
 *
 * Every figure is observed rather than declared: the pid list is what each child
 * announced on its own handshake line, and the count is what the rig held, not what the
 * rung asked for. A rung that reached this table passed the identity gate, so the table
 * is a record of what the gate saw rather than a second check.
 *
 * The heading names the driver and the fixture, and both literals are load-bearing: a
 * later section scan matches on them, and `both drivers` — the phrase this deliberately
 * does not use — names neither.
 */
function processSection(rows: readonly ProcessRow[], logicalCores: number): readonly string[] {
  if (rows.length === 0) return []
  return [
    '## Processes — process-per-node driver, saturating fixture',
    '',
    `Observed, per rung. The host reports **${logicalCores} logical cores**. A rung whose`,
    'observed process count exceeds that is oversubscribed, and a knee there is contention',
    'rather than coordination.',
    '',
    '| nodes | node processes observed | oversubscribed | agent process ids |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.nodes} | ${row.observed} | ${row.observed > logicalCores ? 'yes' : 'no'} |` +
        ` ${row.pids.join(', ')} |`,
    ),
    '',
    'The observed count is `nodes + 1`: the submitting node stays in this driver’s process,',
    'because it holds the store the module is put into, exposes the guard the egress manifest',
    'is read off, and owns the endpoint every remote executor is built over. Counting it is',
    'the honest reading of what the host was asked to run.',
    '',
  ]
}

/**
 * The speedup comparison — BENCH-07 criterion 2.
 *
 * The ratio is published **only** beside the three mechanisms that could have produced it
 * without parallelism, and beside a bound derived from this run rather than from a
 * pre-registered figure. Every quantity here is read off the run.
 */
function speedupSection(
  rungs: readonly SpeedupRung[],
  perShardMs: readonly number[],
  logicalCores: number,
  processRows: readonly ProcessRow[],
): readonly string[] {
  if (rungs.length === 0) return []

  const at = (driver: DriverKind, nodes: number): SpeedupRung | undefined =>
    rungs.find((rung) => rung.driver === driver && rung.nodes === nodes)
  const ladder = [...new Set(rungs.map((rung) => rung.nodes))].sort((a, b) => a - b)
  const ratio = (rung: SpeedupRung | undefined, base: SpeedupRung | undefined): string =>
    rung === undefined || base === undefined || rung.p50 <= 0 ? '—' : `${(base.p50 / rung.p50).toFixed(2)}×`
  const num = (value: number | undefined, digits = 2): string =>
    value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
  const vector = (values: readonly number[] | readonly boolean[]): string =>
    values.length === 0 ? '—' : `${[...new Set(values.map(String))].sort().join('/')}`

  const processBase = at('process-per-node', 1)
  const controlBase = at('in-process', 1)
  const observedIdeal =
    perShardMs.length === 0
      ? null
      : perShardMs.reduce((a, b) => a + b, 0) / Math.max(...perShardMs)

  return [
    '## Speedup — in-process and process-per-node drivers, fixed redundancy 1, saturating fixture',
    '',
    'Two sweeps over one ladder, differing in exactly one thing: whether a node is an',
    'operating-system process. Redundancy is held at **1** on both, so the ratio does not',
    'also vary replication — necessary, and by itself not sufficient, which is what the last',
    'four columns are for.',
    '',
    '**Read the control before reading the ratio.** The `in-process` rows are not flat, and',
    'that is a fact about the rig rather than a defect in it: those nodes are built by',
    '`FabricNode.start`, which composes a `WorkerExecutor` on its own worker thread, so N',
    'in-process nodes are N threads on this host’s cores. What the two curves therefore',
    'compare is **process isolation against threads inside one process** — not parallelism',
    'against none. Any reading of the process-per-node column that does not carry that',
    'sentence is overclaiming.',
    '',
    'The **driver CPU share** column is this driver’s own `process.cpuUsage()` delta across',
    'the rung, over the gross node-seconds it dispatched. That denominator is a proxy and',
    'not a CPU measurement: gross node-seconds is wall time inside each executor call, so on',
    'a genuine multi-process run it includes network wait. The ceiling the process-per-node',
    `rungs are judged against is **${MAX_DRIVER_CPU_SHARE}**, declared in the methodology`,
    'before any of this data existed. The in-process rungs are **not** judged against it —',
    'their work is in this process by construction — and their share is published so the two',
    'can be compared. The two being different is the reading; neither crossing a line is.',
    '',
    '| nodes | driver | p50 makespan | speedup vs its own 1-node rung | incomplete | driver CPU share | churn/task | spec. tax | generations | speculated |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...ladder.flatMap((nodes) =>
      (['process-per-node', 'in-process'] as const).flatMap((driver) => {
        const rung = at(driver, nodes)
        if (rung === undefined) return []
        const base = driver === 'process-per-node' ? processBase : controlBase
        return [
          `| ${nodes} | ${driver} | ${num(rung.p50, 1)}ms | ${ratio(rung, base)} |` +
            ` ${rung.incomplete} | ${num(rung.cpuShare, 3)} | ${num(rung.redispatches)} |` +
            ` ${num(rung.speculationMultiplier)}× | ${vector(rung.generations)} |` +
            ` ${vector(rung.speculated)} |`,
        ]
      }),
    ),
    '',
    '**The three confound readings are the last four columns, and they are published beside',
    'the ratio rather than after it.** `redispatches` (`churn/task`) and the speculation',
    'multiplier (`spec. tax`) have been measured per rung since 20-01 and 20-07 and read as',
    'their identity — `0.00` and `1.00×` — on every rung of the published trivial-fixture',
    'run. That establishes the instruments were quiet on that fixture. It does **not**',
    'establish they will be quiet on this one, and the reason is structural: a shard at',
    'redundancy 1 sits in an unconditional generation loop bounded only by the lease table,',
    'and the speculation allowance does not read redundancy at all. The `generations` and',
    '`speculated` columns are the per-shard vectors those two summarise, printed as the',
    'distinct values observed across the rung’s sixteen shards.',
    '',
    '### The coordination ratio, per rung',
    '',
    '| nodes | in-process p50 | process-per-node p50 | coordination ratio |',
    '| --- | --- | --- | --- |',
    ...ladder.flatMap((nodes) => {
      const control = at('in-process', nodes)
      const proc = at('process-per-node', nodes)
      if (control === undefined || proc === undefined) return []
      return [
        `| ${nodes} | ${num(control.p50, 1)}ms | ${num(proc.p50, 1)}ms |` +
          ` ${proc.p50 > 0 ? `${(control.p50 / proc.p50).toFixed(2)}×` : '—'} |`,
      ]
    }),
    '',
    'Same fixture, same redundancy, same ladder, same shard count, same job path. A ratio',
    'near 1 at a rung where the process curve was supposed to fall is the reading that says',
    'coordination ate the gain. This is **not** the connectivity tax and must not be read as',
    'one: that figure is computed over the in-process trivial curves at a different',
    'redundancy, so there is no connectivity tax figure for any rung here.',
    '',
    '### The ideal bound, derived from this run',
    '',
    ...(observedIdeal === null
      ? [
          'No calibration was taken on this run, so no bound is published. A bound here is a',
          'measurement, and an unmeasured one would be a figure imported from somewhere else.',
        ]
      : [
          `**${observedIdeal.toFixed(2)}×**, computed as sum ÷ max over **${perShardMs.length}**`,
          'per-shard durations measured on the 1-node process-per-node fabric with exactly',
          // The phrase is a literal in the published prose rather than only in this file's
          // comments, and `bench-driver.node.test.ts` requires it there: it is a claim about
          // *how* a published number was measured, so it has to survive into what a reader of
          // the report sees, and into a source scan that strips comments first.
          'one call in flight at a time, so each measurement is that shard’s own duration and',
          'nothing else’s. Each includes one RPC round trip on top of the shard, and no estimate',
          'of that is subtracted. The block was already resident at the agent from the rung’s',
          'measured runs, so this is compute rather than first fetch. **No pre-registered figure',
          'is published beside it**: the withdrawn one was derived at eight partitions and this',
          'run uses sixteen.',
        ]),
    '',
    `The host reports **${logicalCores} logical cores**. Rungs whose observed node-process`,
    `count exceeded that: ${
      processRows
        .filter((row) => row.observed > logicalCores)
        .map((row) => String(row.nodes))
        .join(', ') || 'none'
    }.`,
    '',
  ]
}

// ── BENCH-07 criterion 3 — the excluded rung, attempted one lever at a time ────────────

/**
 * The inbound rate a pinned attempt runs at.
 *
 * **A configuration choice, not a measurement**, and the distinction is the point of the
 * whole block: this is the value `.planning/BENCHMARK-RESULTS.md`'s stored paragraph *named*
 * as the cause of the excluded rung. Pinning a node back to it is what turns that name into
 * something a run can exercise. Nothing here claims a node runs at this figure by default —
 * what a default node derives is read off the node and published beside every attempt.
 */
const PINNED_INBOUND_THRESHOLD = 5

/** Where a pinned cap goes, or the named absence when an attempt pins nothing. */
type CapPlacement = 'derived-on-every-node' | 'pinned-on-the-receiving-node' | 'pinned-on-every-agent'

/**
 * One cell of the criterion-3 factorial.
 *
 * Every field is a **choice**, and nothing on this type is a reading. What the attempt
 * observed lives on {@link AttemptOutcome}, which is built from the run.
 */
interface Attempt {
  /** A, B, C… — the letter the published table and the prose both refer to it by. */
  readonly name: string
  readonly driver: DriverKind
  readonly nodes: number
  readonly dial: DialDirection
  readonly cap: CapPlacement
  /** What this cell is in the table to answer. Published beside its outcome. */
  readonly asks: string
}

/**
 * The block, in the order it runs.
 *
 * **Criterion 3 names two rungs and the committed run excludes one.** The 8-node
 * real-transport rung already runs — `n = 19`, `incomplete = 0` in the run stamped
 * 2026-08-01 — so the 8-node cell here is a **control with a known outcome**, not an
 * unknown, and the whole factorial sits at 16.
 *
 * The three levers are independent and only one of them is what BENCH-07 is about: raise
 * the option, stagger the joins, or change which side receives the dials. Adopting the
 * spawn pattern moves the process split **and** the dial direction at once, so the cells
 * below hold everything but one thing fixed at a time. **Staggering is not exercised**;
 * every attempt records `stagger: none` and the published section says so.
 */
const CRITERION_3_ATTEMPTS: readonly Attempt[] = [
  {
    name: 'A8',
    driver: 'in-process',
    nodes: 8,
    dial: 'workers-to-submitter',
    cap: 'derived-on-every-node',
    asks: 'the control: whether the rung that already runs still runs against today’s code',
  },
  {
    name: 'A',
    driver: 'in-process',
    nodes: 16,
    dial: 'workers-to-submitter',
    cap: 'derived-on-every-node',
    asks: 'the arrangement every published number was taken under — whether the exclusion still reproduces at all',
  },
  {
    name: 'B',
    driver: 'in-process',
    nodes: 16,
    dial: 'workers-to-submitter',
    cap: 'pinned-on-the-receiving-node',
    asks: 'the cap pinned back to the value the published exclusion blames, on the node that receives the dials',
  },
  {
    name: 'C',
    driver: 'in-process',
    nodes: 16,
    dial: 'submitter-to-workers',
    cap: 'derived-on-every-node',
    asks: 'the dial direction alone, with the process split held at one process',
  },
  {
    name: 'D',
    driver: 'process-per-node',
    nodes: 16,
    dial: 'submitter-to-workers',
    cap: 'derived-on-every-node',
    asks: 'this phase’s headline configuration',
  },
  {
    name: 'E',
    driver: 'process-per-node',
    nodes: 16,
    dial: 'submitter-to-workers',
    cap: 'pinned-on-every-agent',
    asks: 'the cap pinned on the agents — kept because its failure would inform, not because its success would',
  },
  {
    name: 'F',
    driver: 'process-per-node',
    nodes: 16,
    dial: 'workers-to-submitter',
    cap: 'derived-on-every-node',
    asks: 'N processes on one host opening connections to one node, at the derived limit',
  },
  {
    name: 'G',
    driver: 'process-per-node',
    nodes: 16,
    dial: 'workers-to-submitter',
    cap: 'pinned-on-the-receiving-node',
    asks: 'the positive control — the attempt that is supposed to fail',
  },
]

/** What an attempt turned out to do. Every field here is read off the run. */
interface AttemptOutcome {
  readonly attempt: Attempt
  /** Whether the job completed. The signal — a rung that stands up completes one job. */
  readonly completed: boolean
  /**
   * The published reason, built by `describeExclusion` from what was actually caught, or
   * `null` where nothing was.
   */
  readonly failure: string | null
  /** The submitting node's own limits and connection count, or a named absence. */
  readonly submitter: SubmitterReading | 'no-node-survived-to-be-read'
  /** Each agent's announced threshold, or a named absence on a rig with no agents. */
  readonly agentThresholds: readonly number[] | 'no-agent-announced-a-limit'
}

/**
 * Run one attempt: build the rig it names, put one job through the measured path, close it.
 *
 * **One job, not a sweep.** The question is whether the rung stands up at all, and a
 * completed job answers it; a full `measure` would spend minutes answering it again with
 * percentiles nobody in this block reads.
 *
 * **The job path is `runnerOver`'s**, the same body both published drivers use, so an
 * attempt cannot succeed or fail on a second copy of the submit logic.
 *
 * A failing attempt's partial rig closes itself: `realFabric` releases what it started on
 * the way out of a throw and `processFabric` has its own `undo`, which is why `held` being
 * `undefined` after a construction failure is correct rather than a leak. What `finally`
 * covers is the other case — a rig that was built and whose *job* then failed.
 */
async function runAttempt(attempt: Attempt): Promise<AttemptOutcome> {
  // **This heading must not match `/^ {2}(memory|real) transport, (\d+) node\(s\)…$/`** —
  // `coverage-agents.node.test.ts` asserts that pattern's matches over a `--quick` run's
  // stdout are exactly five specific entries. This block does not run under `--quick` at
  // all, and the heading is still written so it could not collide if it ever did.
  process.stdout.write(
    `  criterion 3, attempt ${attempt.name}, ${attempt.driver}, ${String(attempt.nodes)} node(s)…\n`,
  )

  let held: Fabric | undefined
  let agents: readonly AgentHandle[] | undefined

  /** Read off the live rig, at the moment of the call, in both the success and failure arms. */
  const readOff = (): Pick<AttemptOutcome, 'submitter' | 'agentThresholds'> => ({
    submitter: held?.submitterReading?.() ?? 'no-node-survived-to-be-read',
    agentThresholds:
      agents === undefined
        ? 'no-agent-announced-a-limit'
        : agents.map((agent) => agent.inboundConnectionThreshold),
  })

  try {
    const run = runnerOver(async (count) => {
      const built =
        attempt.driver === 'in-process'
          ? await realFabric(count, 'trivial', {
              dial: attempt.dial,
              ...(attempt.cap === 'pinned-on-the-receiving-node'
                ? { inboundThreshold: PINNED_INBOUND_THRESHOLD }
                : {}),
            })
          : await processFabric(count, moduleBytesFor('trivial'), recordFor('trivial'), {
              rpcTimeoutMs: 30_000,
              maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
              trustAnchors: [BENCH_TRUST_ANCHOR],
              dial: attempt.dial,
              // Under the process driver the node that receives the dials on the
              // `workers-to-submitter` arm is the one in **this** process, so the cap goes
              // through a different option — an agent-side flag cannot reach it.
              ...(attempt.cap === 'pinned-on-every-agent'
                ? { inboundThreshold: PINNED_INBOUND_THRESHOLD }
                : {}),
              ...(attempt.cap === 'pinned-on-the-receiving-node'
                ? { submitterInboundThreshold: PINNED_INBOUND_THRESHOLD }
                : {}),
            })
      held = built
      if ('agents' in built) agents = (built as ProcessFabric).agents
      return built
    }, newRunnerState())

    const observation = await run(
      {
        nodes: attempt.nodes,
        shards: SHARDS,
        // `min(2, nodes)` and not 1: attempt A exists to reproduce the arrangement the
        // published curves were taken under, and that is the redundancy they ran at. A
        // reproduction at a different replication factor would be a different rung.
        redundancy: Math.min(2, attempt.nodes),
        transport: 'real',
        skew: 'uniform',
        driver: attempt.driver,
        fixture: 'trivial',
        leg: 'public',
      },
      'warm',
    )

    return { attempt, completed: observation.complete, failure: null, ...readOff() }
  } catch (cause) {
    // An integrity failure is not an attempt that could not be measured; it is a
    // measurement that is not of the thing it claims, and it leaves rather than joining a
    // table. Every catch in this file is paired with this line and
    // `bench-driver.node.test.ts` counts the two.
    if (cause instanceof HarnessIntegrityError) throw cause
    const observed: ObservedFailure = {
      errorName: cause instanceof Error ? cause.name : typeof cause,
      message: cause instanceof Error ? cause.message : String(cause),
      config: configurationOf(attempt, readOff()),
    }
    process.stdout.write(`    attempt ${attempt.name} did not complete: ${observed.message}\n`)
    return { attempt, completed: false, failure: describeExclusion(observed), ...readOff() }
  } finally {
    if (held !== undefined) await held.close().catch(() => {})
  }
}

/**
 * The configuration one attempt ran under, as ordered pairs — choices first, then what was
 * read off the live nodes.
 *
 * Ordered rather than a record so two attempts' rendered reasons differ in exactly the pair
 * those two attempts differ in, which is the reading that makes the table legible.
 */
function configurationOf(
  attempt: Attempt,
  observed: Pick<AttemptOutcome, 'submitter' | 'agentThresholds'>,
): readonly (readonly [string, string])[] {
  const submitter = observed.submitter
  return [
    ['driver', attempt.driver],
    ['dial', attempt.dial],
    ['cap', attempt.cap],
    ['nodes', String(attempt.nodes)],
    ['shards', String(SHARDS)],
    ['redundancy', String(Math.min(2, attempt.nodes))],
    ['fixture', 'trivial'],
    ['admissionLimit', String(DECLARED_ADMISSION_LIMIT)],
    // Read off the live node, never restated from the option that asked for it.
    [
      'observedSubmitterInbound',
      submitter === 'no-node-survived-to-be-read' ? submitter : String(submitter.inboundConnectionThreshold),
    ],
    [
      'observedSubmitterPending',
      submitter === 'no-node-survived-to-be-read' ? submitter : String(submitter.maxIncomingPendingConnections),
    ],
    [
      'submitterConnectionsHeld',
      submitter === 'no-node-survived-to-be-read' ? submitter : String(submitter.connections),
    ],
    [
      'observedAgentInbound',
      observed.agentThresholds === 'no-agent-announced-a-limit'
        ? observed.agentThresholds
        : [...new Set(observed.agentThresholds.map(String))].join('/'),
    ],
    // Named rather than exercised. See the published section.
    ['stagger', 'none'],
    // Read off the flag rather than asserted: a `--discover` run starts a provider and
    // enrols every worker, so its rung holds a different population from this one and a
    // reader comparing the two has to be told which was in force.
    ['discover', DISCOVER ? 'on' : 'off'],
    // Same reading and the same reason one row up. A `--sovereign` run clears every worker
    // for an owner, mints a chain and dispatches one owner-labelled shard through it before
    // the rung's own runs begin — so the rung stood up under a different node configuration
    // and a reader comparing it with a default row has to be told so here rather than
    // inferring it from a line in the terminal.
    ['sovereign', SOVEREIGN ? 'on' : 'off'],
  ]
}

/**
 * Whether the completed/failed split of `outcomes` falls **exactly** along one lever.
 *
 * Returns the partition when no value of that lever appears on both sides, and `null`
 * otherwise. This is a reading taken from the block rather than a claim written into it:
 * with two independent levers moving across seven cells, which one the outcomes separate on
 * is a question the data answers, and a section that named a lever in prose would be
 * asserting the answer the way the paragraph this whole plan removes asserted a cause.
 *
 * `null` is the honest and common result — it says the outcomes do not partition on this
 * lever, which is a finding rather than a failure to find one.
 */
function separatesOn(
  outcomes: readonly AttemptOutcome[],
  lever: (attempt: Attempt) => string,
): string | null {
  const failed = new Set(outcomes.filter((o) => !o.completed).map((o) => lever(o.attempt)))
  const passed = new Set(outcomes.filter((o) => o.completed).map((o) => lever(o.attempt)))
  if (failed.size === 0 || passed.size === 0) return null
  for (const value of failed) if (passed.has(value)) return null
  return `${[...failed].join(', ')} on every failure, ${[...passed].join(', ')} on every success`
}

/**
 * The criterion-3 section — what the block attempted, what happened, and what it therefore
 * does and does not establish.
 *
 * The heading names both drivers and the fixture, so a later provenance scan finds a driver
 * in it rather than a phrase that names neither.
 */
function criterionThreeSection(outcomes: readonly AttemptOutcome[]): readonly string[] {
  if (outcomes.length === 0) return []
  const anyFailed = outcomes.some((outcome) => !outcome.completed)
  const positiveControl = outcomes.find((outcome) => outcome.attempt.name === 'G')
  const capOf = (outcome: AttemptOutcome): string => {
    const submitter = outcome.submitter
    const agents =
      outcome.agentThresholds === 'no-agent-announced-a-limit'
        ? 'no agent'
        : [...new Set(outcome.agentThresholds.map(String))].join('/')
    const receiving =
      submitter === 'no-node-survived-to-be-read'
        ? 'unread'
        : `${String(submitter.inboundConnectionThreshold)}/${String(submitter.maxIncomingPendingConnections)}`
    return `${receiving} (driver’s node), ${agents} (agents)`
  }

  return [
    '## The excluded rungs, re-measured — in-process and process-per-node drivers, trivial fixture',
    '',
    '**Criterion 3 names two rungs, and the committed run of 2026-08-01 excluded one.** Its',
    'real-transport curve carries a working 8-node rung at `n = 19` with `incomplete = 0`, and',
    'the only excluded row is `real transport, 16 nodes`. This phase did not rescue the 8-node',
    'rung and does not claim to have: it was already running before any of this landed. The',
    'scope of the criterion is therefore **one** rung, stated here rather than absorbed —  a',
    'rung that quietly appears between the plan and the results is as unreadable as one that',
    'quietly vanishes.',
    '',
    'So attempt A8 below is a control whose outcome is known, and every other attempt sits at',
    'the one rung actually in dispute. Each varies **one** thing from its neighbour, because',
    'three independent levers exist — raise the option, stagger the joins, change which side',
    'receives the dials — and adopting the spawn pattern moves two of them at once.',
    '',
    '| attempt | driver | dial | cap pinned | nodes | job completed | observed inbound/pending | connections held by the driver’s node |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...outcomes.map((outcome) => {
      const submitter = outcome.submitter
      return (
        `| ${outcome.attempt.name} | ${outcome.attempt.driver} | ${outcome.attempt.dial} |` +
        ` ${outcome.attempt.cap} | ${String(outcome.attempt.nodes)} |` +
        ` ${outcome.completed ? 'yes' : '**no**'} | ${capOf(outcome)} |` +
        ` ${submitter === 'no-node-survived-to-be-read' ? submitter : String(submitter.connections)} |`
      )
    }),
    '',
    'What each attempt is in the table to answer, and what any of them that failed reported:',
    '',
    '| attempt | asks | reported |',
    '| --- | --- | --- |',
    ...outcomes.map(
      (outcome) =>
        `| ${outcome.attempt.name} | ${outcome.attempt.asks} | ${outcome.failure ?? 'the job completed'} |`,
    ),
    '',
    '**Attempt E is not a control and the table must not be read as though it were.** Under D',
    'and E the submitting node dials outward, so the agents are the dial targets and each is',
    'dialled from one host. What that does to a per-second per-host cap is not derived here,',
    'so E succeeding establishes nothing about the cap. It is kept because it is cheap and',
    'because its *failure* would have informed: **agent-side cap pinned, exercise not',
    'established — the agents’ inbound connection counts were not instrumented under this',
    'direction.**',
    '',
    anyFailed
      ? '**At least one attempt failed, and its error and configuration are in the table above.**' +
        ' The pair a reader wants is the failing attempt beside its nearest neighbour: the two' +
        ' reasons differ in exactly the pair the two attempts differ in, which is what makes the' +
        ' lever legible.'
      : '',
    // Which lever the outcomes actually separate on, computed from them. The 8-node control
    // is excluded from this reading and only from this reading: it is the one attempt at a
    // rung that is not in dispute, so leaving it in would let a lever appear to separate on
    // a node count nothing else here varies.
    ...(anyFailed
      ? (() => {
          const disputed = outcomes.filter((outcome) => outcome.attempt.nodes === 16)
          const readings: [string, string | null][] = [
            ['dial direction', separatesOn(disputed, (a) => a.dial)],
            ['driver', separatesOn(disputed, (a) => a.driver)],
            ['cap placement', separatesOn(disputed, (a) => a.cap)],
          ]
          const clean = readings.filter(([, partition]) => partition !== null)
          return [
            '',
            '**Which lever the outcomes separate on, read off the block rather than argued for.**',
            'Taken across the attempts at the disputed rung alone, since the 8-node control is the',
            'one cell at a rung nobody disputes:',
            '',
            ...readings.map(
              ([name, partition]) =>
                `- **${name}** — ${partition ?? 'does not separate them: a value of it appears on both sides'}`,
            ),
            '',
            clean.length === 0
              ? 'No single lever separates the outcomes, so this block attributes the failure to none of them.'
              : `Only ${clean
                  .map(([name]) => name)
                  .join(' and ')} partitions the outcomes cleanly. **A lever whose value appears on both sides cannot be what separated them**, which is what every entry above reading "does not separate" is saying about itself.`,
          ]
        })()
      : []),
    ...(anyFailed
      ? []
      : ['**No attempt failed, so this block contains no positive control and therefore leaves the' +
        ' original cause unmeasured.** Attempt G exists to fail — N processes on one host opening' +
        ' connections to one node whose inbound rate is pinned at the value the published' +
        ' exclusion names. It completed. Seven successes are not a measurement of a cause, and' +
        ' this section reports that rather than reporting them as an answer: what the block' +
        ' establishes is that the rung stands up under every configuration tried, and what it' +
        ' does **not** establish is why the 2026-08-01 run’s rung did not.']),
    '',
    positiveControl === undefined
      ? '**Attempt G did not run at all**, so the block has no positive control by omission rather' +
        ' than by outcome.'
      : `Attempt G — the positive control — ${positiveControl.completed ? 'completed' : 'failed, which is what it exists to do'}.`,
    '',
    '**Two levers this block did not exercise, named rather than left unmentioned.**',
    'Staggering the joins is a real third lever and every attempt above records',
    '`stagger: none`; naming it is not measuring it. And **the agents’ inbound connection',
    'counts were not instrumented**: the agents are child processes, nothing announces their',
    'counts, and the only connection population this rig can read is the driver’s own node’s.',
    'No attempt’s outcome above is explained by a count nobody read.',
    '',
    `Every attempt ran with the discovery arm **${DISCOVER ? 'on' : 'off'}**. A discovering run`,
    'starts a provider and enrols every worker, so its rung holds a different node population',
    'from these — stated because a reader comparing the two would otherwise be comparing',
    'different fabrics.',
    '',
  ]
}

/**
 * The run this one replaced, and where its figures went.
 *
 * **This section exists because `main()` rewrites the report wholesale.** Both `writeFile`
 * calls at the end of this function name `.planning/BENCHMARK-RESULTS.md` and
 * `.planning/bench/raw.json`, and the memory and real ladders are swept on the same rungs
 * the 2026-08-01 run swept — so every one of that run's figures is overwritten with a new
 * number for the same configuration the moment this driver starts. BENCH-07 criterion 4's
 * second half is *no figure is silently replaced*, and that cannot be satisfied by
 * re-deriving those numbers and then checking that a row of the right shape exists: a shape
 * check passes against any values whatsoever. It is satisfied by the earlier values
 * surviving in a file nothing regenerates, and by this section saying the replacement
 * happened.
 *
 * **No driver writes the path named below**, which is what makes it a floor rather than a
 * courtesy: a later phase's benchmark run cannot take those figures with it either.
 *
 * The heading names its driver and fixture like every other figure-carrying section, and
 * `bench-results.node.test.ts` requires this literal to exist here — so deleting this
 * renderer is a red test rather than a report that quietly stops pointing at the artifact.
 */
function frozenRunSection(): readonly string[] {
  return [
    '## Earlier run — frozen (in-process driver, trivial fixture)',
    '',
    'The run stamped `2026-08-01T06:09:01.272Z` published a memory ladder over 1/2/4/8/16',
    'nodes and a real-transport ladder over 1/2/4/8, both in-process on the trivial fixture.',
    '**Every rung it published has been re-measured by the run above and overwritten in this',
    'file.** Its own figures survive byte for byte in',
    '[`BENCHMARK-RESULTS-2026-08-01.md`](./BENCHMARK-RESULTS-2026-08-01.md), which this',
    'driver does not write and no later run of it will.',
    '',
    '**Do not read the tables above as still containing those values.** They are a second',
    'measurement of the same configurations, taken on a different day, under a different',
    'load, by a driver this phase changed — so a reader comparing the two artifacts is',
    'comparing two runs, which is the only honest comparison available. What a reader must',
    'be able to tell apart is a figure that *changed* from a figure that was *replaced*, and',
    'both files existing is what makes that possible.',
    '',
  ]
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
    /**
     * The owner denominator, or absent when this rung's job defined no owners — which is
     * every rung of this driver. See {@link coverageReading} for why absence is the
     * decision rather than the omission.
     */
    coverage?: string
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
    // CHURN-05. Printed only where the job defined owners, so the line's presence is the
    // information — see {@link coverageReading}, where the decision and its alternative
    // are argued. On this driver that is never, and the silence is what
    // `coverage-agents.node.test.ts` reads.
    const coverage = coverageReading(held)
    if (coverage !== null) {
      process.stdout.write(`    owner coverage (${population}): ${coverage}\n`)
    }
    // Absent, not `undefined` and not a placeholder string: `exactOptionalPropertyTypes`
    // makes those different, and a reader of `raw.json` must be able to tell *this rung
    // reduced nothing* from *this rung's aggregation was not attested* by the presence of
    // the key alone, exactly as the terminal reader tells them by the presence of a line.
    attested.push({
      config,
      population,
      reading,
      ...(aggregate === null ? {} : { aggregate }),
      ...(coverage === null ? {} : { coverage }),
    })
  }

  const memory = runnerFor(memoryFabric)
  const memoryResults: SweepResult[] = []
  for (const nodes of LADDER) {
    process.stdout.write(`  memory transport, ${nodes} node(s)…\n`)
    memoryResults.push(
      await measure(
        memory.run,
        {
          nodes,
          shards: SHARDS,
          redundancy: Math.min(2, nodes),
          transport: 'memory',
          skew: 'uniform',
          // Provenance, and a statement of fact rather than a default: every rung of
          // this sweep builds its nodes in this process, dispatches the trivial module,
          // and submits public shards. That is what the published memory curve is, and
          // what it was before these three fields existed.
          driver: 'in-process',
          fixture: 'trivial',
          leg: 'public',
        },
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
          {
            nodes,
            shards: SHARDS,
            redundancy: Math.min(2, nodes),
            transport: 'real',
            skew: 'uniform',
            // In-process, and the word is accurate rather than conservative: this rig
            // starts N real libp2p nodes with `FabricNode.start` **in this process**,
            // and dials them over loopback. It is a real transport and a single
            // process, which is exactly the pair the process-per-node driver separates.
            driver: 'in-process',
            fixture: 'trivial',
            leg: 'public',
          },
          { runs: RUNS },
        ),
      )
      sayAttestation(`real transport, ${nodes} nodes`, real.attestationFor(nodes))
    } catch (cause) {
      // An integrity failure leaves before the paragraph below can be attached to it.
      // Held here even though no rung of this sweep calls the gate today: propagation is
      // a property of every catch between a raise site and the top, not of the raise
      // site, and `bench-driver.node.test.ts` counts the two rather than looking for one.
      if (cause instanceof HarnessIntegrityError) throw cause
      // Published as excluded, never silently dropped — the methodology commits to
      // this. A rung that vanishes between plan and results is indistinguishable
      // from one removed because its number was inconvenient.
      const detail = cause instanceof Error ? cause.message : String(cause)
      process.stdout.write(`    excluded: ${detail}\n`)
      excluded.push({
        config: `real transport, ${nodes} nodes`,
        // **Built from the failure that happened.** What stood here was one stored
        // paragraph asserting that libp2p's per-host inbound cap of five killed the
        // handshake — attached to every error this catch could ever see, with nothing read
        // off the error but its message, and naming a constant this code does not
        // necessarily run at. See `describeExclusion` for the whole of that argument.
        //
        // **No `interpretation` is passed, and none can be from here.** The criterion-3
        // factorial that could supply one runs later in this same `main()`, so any
        // interpretation written at this call site would be a claim made before its
        // evidence existed — which is the defect again with a different sentence in it.
        reason: describeExclusion({
          errorName: cause instanceof Error ? cause.name : typeof cause,
          message: detail,
          config: [
            ['driver', 'in-process'],
            ['dial', 'workers-to-submitter'],
            ['nodes', String(nodes)],
            ['shards', String(SHARDS)],
            ['redundancy', String(Math.min(2, nodes))],
            ['fixture', 'trivial'],
            ['admissionLimit', String(DECLARED_ADMISSION_LIMIT)],
            ['discover', DISCOVER ? 'on' : 'off'],
            ['sovereign', SOVEREIGN ? 'on' : 'off'],
            ['stagger', 'none'],
          ],
        }),
      })
    }
  }
  const realEgress = real.egressTotals()
  process.stdout.write(
    `  real transport egress manifest: ${realEgress.entries} frames, ${realEgress.bytes} bytes\n`,
  )
  await real.dispose()

  // ── the fixed-redundancy speedup sweeps, one per driver ────────────────────────────
  //
  // Two sweeps over the identical ladder, the identical fixture, the identical shard
  // count and the identical job path, differing in exactly one thing: whether a node is a
  // process. A single curve whose shape has to be interpreted is not a finding.
  const multiProcess: SweepResult[] = []
  const controlSweep: SweepResult[] = []
  const speedupRungs: SpeedupRung[] = []
  const processRows: ProcessRow[] = []
  let perShardMs: readonly number[] = []

  if (!QUICK) {
    const proc = processRunnerFor(async (nodes) =>
      processFabric(nodes, kernelBytes, SATURATING_RECORD, {
        rpcTimeoutMs: 30_000,
        maxConcurrentTasks: DECLARED_ADMISSION_LIMIT,
        trustAnchors: [BENCH_TRUST_ANCHOR],
      }),
    )
    for (const nodes of SPEEDUP_LADDER) {
      // **This heading must not match `/^ {2}(memory|real) transport, (\d+) node\(s\)…$/`.**
      // `coverage-agents.node.test.ts` asserts that pattern's matches over a `--quick`
      // run's stdout are exactly five specific entries, so printing a speedup rung in the
      // transport form would break an equality assertion in a file about coverage
      // rendering. Do not tidy this into that shape.
      process.stdout.write(`  speedup, process-per-node, ${nodes} node(s)…\n`)
      const cpuBefore = process.cpuUsage()
      try {
        const measured = await measure(
          proc.run,
          {
            nodes,
            shards: SHARDS,
            // Fixed at 1 across the whole ladder. The published ladders run
            // `min(2, nodes)`, so a ratio across them varies parallelism *and*
            // replication. Holding it here removes that one — and is necessary rather
            // than sufficient, which is why the three confound readings are published
            // beside the ratio.
            redundancy: 1,
            transport: 'real',
            skew: 'uniform',
            driver: 'process-per-node',
            fixture: 'saturating',
            leg: 'public',
          },
          { runs: RUNS },
        )
        const spent = process.cpuUsage(cpuBefore)
        const driverCpuMs = (spent.user + spent.system) / 1000
        const readings = proc.readingsFor(nodes)
        const fabric = proc.fabricFor(nodes)
        if (readings === undefined || fabric === undefined) {
          throw new Error(
            `the process-per-node rung at ${nodes} nodes produced no readings and no live rig, ` +
              'so nothing about it could be checked',
          )
        }
        gateRung(`process-per-node, ${nodes} nodes`, {
          identity: {
            expected: nodes,
            driverPid: process.pid,
            agents: fabric.agents.map((agent) => ({
              childPid: agent.pid,
              announcedPid: agent.announcedPid,
              peerId: agent.peerId,
            })),
            executorNodeIds: fabric.executors.map((executor) => executor.nodeId),
            submitterPeerId: fabric.submitterPeerId,
          },
          cpu: { driverCpuMs, shardComputeMs: readings.computeMs },
          statuses: readings.statuses,
          declared: 'saturating',
          moduleCid: readings.moduleCid,
        })
        multiProcess.push(measured)
        processRows.push({
          nodes,
          pids: fabric.agents.map((agent) => agent.pid),
          // `nodes + 1`: the submitting node stays in this process, because it holds the
          // store the module is put into, exposes the guard the manifest is read off, and
          // owns the endpoint every executor is built over. Read off the rig rather than
          // computed from the rung's node count, which is the whole point of the table.
          observed: fabric.agents.length + 1,
        })
        speedupRungs.push(rungOf('process-per-node', nodes, measured, readings, driverCpuMs))
        sayAttestation(`speedup, process-per-node, ${nodes} nodes`, proc.attestationFor(nodes))

        if (nodes === 1) {
          // The only window in which the 1-node fabric is both warm and still up. Nothing
          // between here and the `measure` above does any work on it — the readings are
          // map lookups and the gate is pure — so the rig is in the state the rung left
          // it, with the module block already resident at the agent.
          perShardMs = await calibratePerShard(fabric)
        }
      } catch (cause) {
        if (cause instanceof HarnessIntegrityError) throw cause
        const detail = cause instanceof Error ? cause.message : String(cause)
        const kind = cause instanceof Error ? cause.name : typeof cause
        process.stdout.write(`    excluded: ${detail}\n`)
        excluded.push({
          config: `speedup, process-per-node driver, ${nodes} nodes`,
          // Derived from the error that was observed, never asserted: its class, its
          // message, and the configuration in force. Any reading of *why* is a reading a
          // later measurement has to supply, and saying so is cheaper than a paragraph
          // that would be attached whatever went wrong.
          reason:
            `\`${kind}: ${detail}\` — measured at ${nodes} node process(es) plus this driver's ` +
            `own node, redundancy 1, ${SHARDS} shards of the saturating fixture, every node ` +
            `admitting at ${DECLARED_ADMISSION_LIMIT} concurrent tasks. What that error is ` +
            'about is not interpreted here.',
        })
      }
    }
    await proc.dispose()

    // The control. Same ladder, same fixture, same redundancy, same job path — built by
    // the rig whose nodes live in this process.
    //
    // **It does not stay flat, and the plan that asked for it predicted that it would.**
    // The prediction was that N in-process nodes share one JavaScript event loop and
    // therefore cannot parallelise; that is true of `memoryFabric`, which builds its
    // executors directly, and **false** of this rig, which builds each node with
    // `FabricNode.start` — and a `FabricNode` composes a `WorkerExecutor` over
    // `createThread: workerThread`, so every node's guest runs on **its own worker
    // thread**. N in-process nodes are N threads on this host's cores.
    //
    // Measured rather than reasoned: at two nodes this control halved its own one-node
    // makespan. So the difference the sweeps below publish is not *parallelism against
    // none* — it is **process isolation against threads inside one process**, and that is
    // exactly the reading a single curve could not have produced. A control that refutes
    // its own rationale is the reason a control is run at all.
    const control = runnerFor(async (nodes) => realFabric(nodes, 'saturating'))
    for (const nodes of SPEEDUP_LADDER) {
      process.stdout.write(`  speedup, in-process, ${nodes} node(s)…\n`)
      const cpuBefore = process.cpuUsage()
      try {
        const measured = await measure(
          control.run,
          {
            nodes,
            shards: SHARDS,
            redundancy: 1,
            transport: 'real',
            skew: 'uniform',
            driver: 'in-process',
            fixture: 'saturating',
            leg: 'public',
          },
          { runs: RUNS },
        )
        const spent = process.cpuUsage(cpuBefore)
        const driverCpuMs = (spent.user + spent.system) / 1000
        const readings = control.readingsFor(nodes)
        if (readings === undefined) {
          throw new Error(
            `the in-process control rung at ${nodes} nodes produced no readings, so nothing ` +
              'about it could be checked',
          )
        }
        // Checks 3 and 4 only. There are no child processes to identify, and this rig's
        // work *is* in the driver by construction, so a ceiling on the driver's share
        // would be a check on the definition rather than on the run. The share is
        // measured and published beside the other one; the two being different is the
        // reading, not that either crosses a line.
        gateRung(`in-process, ${nodes} nodes`, {
          statuses: readings.statuses,
          declared: 'saturating',
          moduleCid: readings.moduleCid,
        })
        controlSweep.push(measured)
        speedupRungs.push(rungOf('in-process', nodes, measured, readings, driverCpuMs))
        sayAttestation(`speedup, in-process, ${nodes} nodes`, control.attestationFor(nodes))
      } catch (cause) {
        if (cause instanceof HarnessIntegrityError) throw cause
        const detail = cause instanceof Error ? cause.message : String(cause)
        const kind = cause instanceof Error ? cause.name : typeof cause
        process.stdout.write(`    excluded: ${detail}\n`)
        excluded.push({
          config: `speedup, in-process driver, ${nodes} nodes`,
          reason:
            `\`${kind}: ${detail}\` — measured at ${nodes} node identities inside this ` +
            `process, redundancy 1, ${SHARDS} shards of the saturating fixture, every node ` +
            `admitting at ${DECLARED_ADMISSION_LIMIT} concurrent tasks. What that error is ` +
            'about is not interpreted here.',
        })
      }
    }
    await control.dispose()
  }

  // ── BENCH-07 criterion 3 — the one rung the committed run excludes ──────────────────
  //
  // **Off the quick path, and the gate is not a preference.** `coverage-agents.node.test.ts`
  // spawns this driver with `--quick`, waits for the whole run inside a 180 s budget and
  // asserts it exits 0. This block builds rigs of seventeen nodes eight times; running it
  // there would redden a guard about coverage rendering for a reason about neither.
  const criterionThree: AttemptOutcome[] = []
  if (!QUICK) {
    for (const attempt of CRITERION_3_ATTEMPTS) {
      // Each attempt's rig is closed before the next is built — by `runAttempt`'s own
      // `finally` on the success path, and by the rig's own release on a construction
      // failure. One failure does not end the block, which is what makes it a factorial
      // rather than a sequence that stops at its first interesting cell.
      criterionThree.push(await runAttempt(attempt))
    }
  }

  process.stdout.write('  skewed configuration, memory transport…\n')
  const skewRunner = runnerFor(memoryFabric)
  const skewed = await measure(
    skewRunner.run,
    {
      nodes: 4,
      shards: SHARDS,
      redundancy: 2,
      transport: 'memory',
      skew: 'skewed',
      // The same three facts as the memory sweep above; only `skew` differs, which is
      // the one thing this supplementary reading varies.
      driver: 'in-process',
      fixture: 'trivial',
      leg: 'public',
    },
    { runs: RUNS },
  )
  sayAttestation('skewed configuration, memory transport, 4 nodes', skewRunner.attestationFor(4))
  await skewRunner.dispose()

  process.stdout.write('  single-threaded baseline…\n')
  const baselineSummary = summarise((await baseline(RUNS)).slice(1))
  const wasmSummary = summarise((await wasmInProcess(RUNS)).slice(1))

  const maxNodes = Math.max(...LADDER)
  // Read from the host through the same `Machine` the report already publishes, so the
  // oversubscription statement below and the inventory table cannot disagree.
  const logicalCores = inventory(maxNodes).machines[0]?.logicalCores ?? 0
  const report = {
    title: 'o2.services — benchmark run',
    at: new Date().toISOString(),
    inventory: inventory(maxNodes),
    baseline: baselineSummary,
    memoryTransport: memoryResults,
    realTransport: realResults,
    /**
     * The process-per-node curve, kept apart from `realTransport` rather than appended to
     * it. `connectivityTax` keys on `config.nodes` and now refuses a repeated count, and
     * the tax is defined over one configuration per node count per transport — these
     * rungs vary the driver and the fixture, so they are a different measurement.
     */
    multiProcess,
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
    /**
     * Riders: the speedup comparison's inputs, carried into `raw.json` beside the
     * rendered sections below so a reader of the data sees what a reader of the markdown
     * saw. `Report` does not declare them, which is the same shape `attestation` already
     * rides in.
     */
    speedup: speedupRungs,
    processes: processRows,
    /** The serial calibration the derived ideal is computed from. Per-shard, in order. */
    calibrationPerShardMs: perShardMs,
    /**
     * BENCH-07 criterion 3 — every attempt at the disputed rung, with what it was configured
     * to do and what it observed. Rides into `raw.json` beside the section rendered below,
     * the same shape `attestation` and `speedup` already ride in.
     */
    criterionThree,
    unmet: [
      '**No parallel speedup is measurable on the memory-transport curve, by construction' +
        ' — and this entry no longer says that about every in-process rig, because that' +
        ' was measured false.** `memoryFabric` builds its executors directly, so its N' +
        ' node identities share one OS process *and* one JavaScript event loop, and its' +
        ' curve measures **coordination cost** rather than parallelism. The real-transport' +
        ' rig does not: it builds each node with `FabricNode.start`, and a `FabricNode`' +
        ' composes a `WorkerExecutor` over its own worker thread, so N in-process nodes are' +
        ' N threads on this host’s cores. The previous wording — *every node in both curves' +
        ' runs inside one OS process on one JavaScript event loop* — was true of the first' +
        ' rig and false of the second, and is corrected here rather than carried forward.',
      '**What the `process-per-node` driver therefore adds is process isolation, not' +
        ' parallelism where there was none.** Each of its nodes is an operating-system' +
        ' process, checked by reading the pid the child announced on its own handshake line' +
        ' against the pid this driver was handed by `spawn`, and by requiring every built' +
        ' executor to address a node some observed child announced. A rung that failed any' +
        ' of those readings aborts the run and produces no report at all, so a curve' +
        ' existing here is itself part of the claim. The in-process control below is run on' +
        ' the identical fixture, redundancy, ladder and job path precisely so the' +
        ' difference between the two is the one thing that varied.',
      '**What the `process-per-node` curve does NOT establish is distinct machines.** Its' +
        ' processes share one host, one CPU, one memory bus and one scheduler, so a rung' +
        ' whose observed process count exceeds the logical core count is oversubscribed' +
        ' and a knee there is contention rather than coordination. The observed process' +
        ' count and the core count are both published below, per rung, so a reader can' +
        ' see which rungs those are rather than take a claim about it.',
      // The two phrases below are single string literals and are deliberately not broken
      // across a concatenation. `bench-results.node.test.ts`'s linkage block requires each
      // to exist unbroken in this file, and it caught them assembled from three fragments
      // on the first take: a sentence a reader must not be able to lose has to be findable
      // in the source that writes it, not only in the output that happens to join it.
      '**BENCH-06’s distinct-machine half is descoped, and ' +
        'unmeasured is not met' +
        '.** Every rung in this report ran on one host, and a same-host run ' +
        '**cannot detect divergence between machines**' +
        ' whatever its process count: one CPU, one V8' +
        ' and one libc produce one answer, and a divergence is a disagreement between two.' +
        ' **Spawning an operating-system process per node does not close this**, and no' +
        ' section below should be read as though it did — what process isolation buys is' +
        ' separate address spaces and separate schedulers on the same machine, which is a' +
        ' different property from two machines disagreeing about a float. What would measure' +
        ' it is a second host, and one was not available. Recorded in these words because' +
        ' this is the phase whose report is most likely to be read as having closed it.',
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
      '**A `--sovereign` run is not comparable with a default one, and no figure taken' +
        ' under that flag is published beside a default curve.** AUTH-03’s requestor half' +
        ' — `delegate` and `CapabilitySupplier` — has a caller reachable from this entry' +
        ' point: `--discover --sovereign` clears every worker for one owner, mints a chain' +
        ' rooted at the key those workers enrolled under, and dispatches one owner-labelled' +
        ' shard through executors discovery built. **That leg is a dispatch-path' +
        ' demonstration and not a measurement**: it runs once per real rig, during' +
        ' construction and outside every timed region, as a job of its own that no rung' +
        ' reads. What it nonetheless changes is what the rig IS — every worker starts with a' +
        ' per-node clearance it does not otherwise have, and holds one row it does not' +
        ' otherwise hold — which is exactly why the flag exists, why it is off by default,' +
        ' and why every configuration row this report renders — each criterion-3 attempt’s,' +
        ' and each excluded rung’s — carries whether it was in force beside `discover`.' +
        ' **What the' +
        ' leg does NOT establish is a sovereignty claim about data**: the shard carries an' +
        ' owner label and a verified chain, and its value is a fixture row this driver' +
        ' invented. The egress and coverage machinery is what would make a data claim; this' +
        ' is about the dispatch path, and saying so is cheaper than letting a reader assume' +
        ' otherwise.',
      '**The `aggregate attestation` lines say the same thing on a default run, for a' +
        ' second and independent reason.** A default rig pins no issuer at all — no' +
        ' provider process is started and no worker enrols — so it hands `reduceJob` the' +
        ' `checks-no-combine-signatures` literal and the aggregate receipt is the named' +
        ' absence by construction. That is truthful rather than degraded: a combine' +
        ' signed by nobody is what a fabric of unenrolled nodes produces. The two' +
        ' receipts are printed separately because they are claims about different things' +
        ' — this rig’s map half and its aggregation half can differ, and on a' +
        ' `--discover` run they do.',
      '**`spec. tax` and `churn/task` are now read from each job, and on a default run' +
        ' they are measurements of a fabric in which nothing went wrong.** Until 20-09 both' +
        ' were literals this driver wrote by hand, and the entry here said so; that sentence' +
        ' is false in the other direction now and this is its replacement. The measurement' +
        ' site reads `JobResult.speculationMultiplier` and `JobResult.redispatches`, which' +
        ' `submitJob` has carried since 20-07 and 20-01 respectively.' +
        ' **What a reader must not conclude from a `1.00` and a `0.00` is that the' +
        ' mechanisms are off.** A job with no straggler reports a multiplier of exactly `1`,' +
        ' and a job in which no lease lapsed reports zero re-dispatches, so these two rows' +
        ' say *this sweep produced no tail and lost no node* — which is what a healthy' +
        ' in-process fabric running a uniform workload should say, and is a weaker statement' +
        ' than the mechanism having fired. A further bound is structural and worth naming:' +
        ' the budget is `floor(shards × 0.1)` and this driver submits 16 shards, so at most' +
        ' one duplicate is affordable per run. **The reading that a straggler really is' +
        ' duplicated across processes, and that the losing copy is still accounted for,' +
        ' lives in `packages/node/src/speculation-agents.node.test.ts`, not here** — and' +
        ' those two call sites are guarded against reverting to constants from the same' +
        ' file.',
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
        ' a constant is not a result. **`spec. tax` and `churn/task` are no longer the same' +
        ' status and the difference is worth keeping straight:** since 20-09 those two are' +
        ' *measured* and merely happen to be constant on this sweep, whereas these two are' +
        ' *decided* by `deriveReduceTree` from inputs the sweep never varies and could not' +
        ' come out otherwise. The reduce columns expected to carry information are `reduce p50`,' +
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
    // The heading names a driver and a fixture like every other figure-carrying section.
    // The three readings beneath it are not all from one rig and the heading says so
    // rather than picking whichever name would have been shortest: the skew reading comes
    // from the in-process driver on the trivial fixture, and the other two run no fabric at
    // all, so there is no driver to name for them and claiming one would be false.
    '## Supplementary — where the time goes — in-process driver, trivial fixture, and two runs with no fabric',
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
    ...processSection(processRows, logicalCores),
    ...speedupSection(speedupRungs, perShardMs, logicalCores, processRows),
    ...criterionThreeSection(criterionThree),
    ...frozenRunSection(),
  ].join('\n')

  await writeFile(join(outDir, 'raw.json'), JSON.stringify({ report, skewed, wasmSummary }, null, 2))
  await writeFile(join(process.cwd(), '.planning', 'BENCHMARK-RESULTS.md'), markdown)

  process.stdout.write(`\nwrote .planning/BENCHMARK-RESULTS.md and .planning/bench/raw.json\n`)
}

await main()
