/**
 * The workload the perf gate measures — the in-process half of the published curve,
 * plus the same-pass reference that makes its number comparable across machines.
 *
 * `harness.ts` measures and `report.ts` publishes; neither of them fails. Until this
 * module existed, throughput could halve and the whole suite stayed green, because the
 * only thing in `packages/bench` that could fail was a unit test over `stats.ts`.
 *
 * ## Why every iteration measures two things
 *
 * A gate on absolute milliseconds does not work on a developer machine, and that is a
 * measurement rather than an opinion. Under eight busy-wait loops on eight cores, this
 * ladder's absolute p50 makespan moved by a factor of 4.03 and its p95 by 4.20, while the
 * paired ratio's p50 moved by 0.56 — that is, downwards. Worse was seen before this
 * module was routed through `submitJobWithEgress`: thirty consecutive passes of that
 * variant, taken while other sessions drove the 1-minute load average from 9 to 37 on
 * this 8-core host, put the 4-node absolute p95 between 5.3ms and 110.6ms — a factor of
 * 13.7, with a median of 8.1ms. A threshold loose enough to survive that is decoration;
 * one tight enough to mean anything fires on load rather than on a code change. Raising
 * the sample size did not help: at 400 iterations per rung the same statistic still
 * ranged over a factor of 3.7 with the worst pass discarded, because a longer pass simply
 * spans more of somebody else's build.
 *
 * So each iteration measures the fabric job **and, immediately after it, the identical
 * work through one local `WasmExecutor` with no fabric at all** — the driver's
 * `wasmInProcess` decomposition, moved inside the measurement loop. The gated statistic
 * is the per-iteration ratio of the two. Both numbers move together when the machine is
 * busy, so what survives is the quantity a code change actually moves: how much the
 * fabric costs on top of executing the same shards locally. The repo already reasons
 * this way — `connectivityTax` is a ratio between two transports and `costCrossover` is
 * a ratio against a single-threaded baseline. This is the same move, applied to the
 * thing that has to hold still over time.
 *
 * The absolute figures are computed and reported too, so a reader can see them; they
 * are simply not what fails.
 *
 * ## Why this rig is a second rig, stated rather than hidden
 *
 * `packages/node/src/bin/bench.ts` already builds a memory-transport rig, and the
 * obvious move would be to share one. It is deliberately not shared, for a reason read
 * out of the repo rather than a preference: `bench-egress.node.test.ts` asserts the
 * *source text* of `bin/bench.ts` still contains `new EgressGuard(`, `guard:
 * requestorGuard`, `submitJobWithEgress(` and the manifest read, because a previous
 * mutation deleted that whole leg and only `tsc` happened to notice. Lifting
 * `memoryFabric` out of that file to share it here would delete those call sites from
 * the file the guard reads, and turn a green guard red for the wrong reason.
 *
 * So this rig reproduces the *shape* of the driver's memory rig — same fixture module,
 * same shard count, same declared admission limit, same redundancy rule, same
 * `measure()`, same `EgressGuard` over the submitting endpoint's transport and the same
 * `submitJobWithEgress` call over it. What the gate protects is the workload, not
 * `bin/bench.ts`'s wiring. Read a green gate as "this workload has not got slower
 * relative to executing it locally", never as "the published driver is unchanged".
 *
 * The egress leg is here because the repository insisted, and that is worth recording
 * rather than quietly obeying. This module first called bare `submitJob` — the tap is a
 * correctness property, not a timing one, and a gate has no business measuring it. The
 * full suite then failed `sovereign-block-refusal.node.test.ts`, which scans every
 * tracked non-test source under `packages/` and asserts bare `submitJob` appears in
 * exactly three files. Its message is the argument: a new production submit path is one
 * `submitJobWithEgress`'s sovereign registration does not cover, and a submitter using it
 * holds the raw row unguarded. Routing through the wrapper both satisfies that invariant
 * and moves this rig closer to the driver, so the cost being gated is the cost the
 * published path actually pays.
 *
 * Portable by the same rule as the rest of `@o2/bench`: no platform imports, no libp2p.
 * Everything here runs over `MemoryNetwork`, so the gate has no sockets to flake on —
 * which is also why it measures this transport and not the real one. The
 * real-transport leg of a full driver run took the better part of ten minutes on the
 * machine that baselined this and excluded its own top rung with `read ECONNRESET`; a
 * gate built on that would be deleted within a month.
 */

import {
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  canonicalCid,
  publicNodes,
} from '@o2/core'
import type { CanonicalValue, Executor, Task } from '@o2/core'
import {
  EgressGuard,
  FetchingBlockstore,
  RemoteExecutor,
  RpcBlockSource,
  RpcEndpoint,
  serveAgent,
  submitJobWithEgress,
} from '@o2/net'
import type { CID } from 'multiformats/cid'
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { measure } from './harness.ts'
import type { JobRunner, Observation, RunConfig, SweepResult } from './harness.ts'
import { summarise } from './stats.ts'
import type { Summary } from './stats.ts'

/**
 * Shards per job — the same count `bin/bench.ts` declares.
 *
 * Duplicated rather than imported, because importing it would make `@o2/bench` depend
 * on `@o2/node`, which `purity.node.test.ts` forbids outright. The consequence is
 * stated where it can be acted on: if the driver's `SHARDS` moves, this gate measures a
 * different workload from the published table and the baseline has to be retaken.
 */
export const GATE_SHARDS = 16

/** The admission limit every node in this rig runs with — matching the driver's. */
export const GATE_ADMISSION_LIMIT = 64

/**
 * Runs per configuration.
 *
 * 101, so that discarding the cold-cache iteration leaves 100 measured samples. Two
 * reasons for a number this much larger than the driver's 20, both measured:
 *
 * - At 20 runs the harness discards one and `percentile` is nearest-rank, so
 *   `ceil(0.95 × 19) = 19` — the reported p95 **is the maximum observation**. Six
 *   passes at that setting put the 1-node p95 between 3.4ms and 20.6ms, a factor of 6,
 *   because the statistic was a single worst sample by construction.
 * - At 100 samples the same rank lands 5 observations below the maximum, which is a
 *   tail quantile rather than an extremum.
 *
 * Below 11 the harness marks the sample unreliable and the gate refuses to pass at all,
 * so this number is load-bearing rather than a comfort setting.
 */
export const GATE_RUNS = 101

/**
 * The node-count ladder the gate measures.
 *
 * A strict prefix of `NODE_LADDER`. The upper rungs are omitted on measured grounds:
 * the whole memory ladder is one process on one event loop, so 8 and 16 nodes add
 * coordination work without adding parallelism, and they cost wall-clock the gate has
 * to spend on every run. Three rungs cover the shape — one node, the first fan-out, and
 * a fan-out wide enough that placement has a choice to make.
 */
export const GATE_LADDER: readonly number[] = [1, 2, 4]

/** `GATE_SHARDS` partitions of the fixture module, uniform — the driver's skew. */
function shardInputs(): readonly CanonicalValue[] {
  return Array.from({ length: GATE_SHARDS }, (_, i) => ({
    partition: i,
    payload: new Uint8Array(16).fill(1),
  }))
}

/** Wraps an executor so every call's wall time lands in the cost total. */
function timed(inner: Executor, into: { gross: number }): Executor {
  return {
    nodeId: inner.nodeId,
    async execute(task: Task) {
      const started = performance.now()
      try {
        return await inner.execute(task)
      } finally {
        into.gross += (performance.now() - started) / 1000
      }
    },
  }
}

interface Rig {
  readonly executors: readonly Executor[]
  readonly blockstore: MemoryBlockstore
  readonly moduleCid: CID
  /**
   * The submitting endpoint's own tap, over the identical `Transport` port
   * `FabricNode.start` wraps — see the egress note in the module comment.
   */
  readonly guard: EgressGuard
  close(): void
}

/** N worker nodes plus a requestor, all on the in-process transport. */
async function memoryRig(nodes: number): Promise<Rig> {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()
  const moduleCid = await originStore.put(MODULE_WRITES_PARTITION)

  // The requestor serves blocks. Without it the workers hold the module but no shard
  // inputs and every run fails — which `measure()` reports as `incomplete`, not as a
  // fast success. The gate asserts on that field for exactly this reason.
  const requestorGuard = new EgressGuard(network.connect('requestor'), 'requestor')
  const callerRpc = new RpcEndpoint(requestorGuard, { timeoutMs: 30_000 })
  serveAgent({
    rpc: callerRpc,
    executor: new WasmExecutor({ nodeId: 'requestor', blockstore: originStore }),
    blockstore: originStore,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: new LocalCapacity({ nodeId: 'requestor', maxConcurrent: GATE_ADMISSION_LIMIT }),
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  const endpoints: RpcEndpoint[] = []
  for (let i = 0; i < nodes; i++) {
    const id = `n${i}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 30_000 })
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['requestor']),
    )
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: id, blockstore: store }),
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      // One per worker, never one shared: `serveAgent` keys a slot on
      // `inputCid:partitionIndex` and both replicas of a shard carry the same key, so a
      // counter shared across workers would refuse the second replica of every shard —
      // the reasoning `bin/bench.ts` records beside its own construction.
      capacity: new LocalCapacity({ nodeId: id, maxConcurrent: GATE_ADMISSION_LIMIT }),
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })
    endpoints.push(rpc)
  }

  // AUTH-03. Permanent and correct, for the same reason `bin/bench.ts` records at
  // its own two sites: every shard this workload submits is `label: 'public'`
  // (`:337`), a public task has no owner and therefore no root key, and the
  // sentinel encodes no `capability` key at all — so the frames this workload
  // measures are byte-identical to the ones the published curve was measured on.
  const remote = endpoints.map(
    (_, i) => new RemoteExecutor(`n${i}`, callerRpc, 'dispatches-unauthenticated'),
  )

  return {
    executors: remote,
    blockstore: originStore,
    moduleCid,
    guard: requestorGuard,
    close() {
      callerRpc.close()
      for (const rpc of endpoints) rpc.close()
    },
  }
}

/**
 * The reference workload: the identical shards through one local executor.
 *
 * No network, no placement, no verification, no CID round trip — the input blocks are
 * written once, outside the timed region, so what is timed is `GATE_SHARDS`
 * instantiations of the same module on the same engine. It is the largest term in the
 * fabric's own cost (the published run puts the WASM figure at 1.450ms p50 against
 * 4.0ms for 4 nodes over the memory transport), which is what makes the ratio between
 * them well-conditioned rather than a small number divided by a smaller one.
 */
async function referenceWorkload(): Promise<() => Promise<void>> {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(MODULE_WRITES_PARTITION)
  const executor = new WasmExecutor({ nodeId: 'reference', blockstore: store })

  const inputCids: CID[] = []
  for (const value of shardInputs()) {
    const encoded = await canonicalCid(value)
    if (!encoded.ok) throw new Error('perf gate reference: fixture input is not encodable')
    await store.put(encoded.bytes)
    inputCids.push(encoded.cid)
  }

  return async () => {
    for (const [partition, inputCid] of inputCids.entries()) {
      await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: partition,
        partitionCount: inputCids.length,
      })
    }
  }
}

/** The configuration measured at one rung — the driver's, minus the egress tap. */
export function gateConfig(nodes: number): RunConfig {
  return {
    nodes,
    shards: GATE_SHARDS,
    // The driver's rule, kept: one node cannot supply two independent executors, so
    // the 1-node rung necessarily runs unverified.
    redundancy: Math.min(2, nodes),
    transport: 'memory',
    skew: 'uniform',
  }
}

/** One rung of the ladder, with its same-pass reference and the ratio between them. */
export interface RungMeasurement {
  /** Straight from `measure()` — the same code path the published curve uses. */
  readonly sweep: SweepResult
  /** The local-executor reference, over the same iterations, same order. */
  readonly reference: Summary
  /**
   * Per-iteration `fabric ÷ reference`, summarised.
   *
   * Paired, not a ratio of the two summaries: pairing is what makes a load spike
   * cancel, since both halves of a pair are measured microseconds apart.
   */
  readonly coordinationRatio: Summary
}

/**
 * Measure the ladder.
 *
 * One rig per rung, reused across that rung's iterations exactly as the driver does —
 * standing a fabric up per iteration would put construction cost inside the makespan.
 *
 * Deliberately no "make it slower" parameter. The way this gate was shown to go red is
 * a real mutation planted in `packages/net`, restored afterwards and confirmed with
 * `cmp` — see the note in `perf-baseline.ts`. A built-in slowdown knob would only prove
 * that the knob works.
 */
export async function measureGateLadder(
  ladder: readonly number[] = GATE_LADDER,
  runs: number = GATE_RUNS,
): Promise<readonly RungMeasurement[]> {
  const runReference = await referenceWorkload()
  const measurements: RungMeasurement[] = []

  for (const nodes of ladder) {
    const rig = await memoryRig(nodes)
    // Filled in dispatch order, one entry per iteration including the cold one, so an
    // index into it lines up with the same index of `SweepResult.observations`.
    const referenceMs: number[] = []

    const run: JobRunner = async (config, codeCache) => {
      const cost = { gross: 0 }
      const executors = rig.executors.map((executor) => timed(executor, cost))
      const shards = shardInputs()

      const started = performance.now()
      const result = await submitJobWithEgress(
        {
          moduleCid: rig.moduleCid,
          shards: shards.map((value) => ({ value, label: 'public' as const })),
          executors,
          nodes: publicNodes(executors),
          redundancy: config.redundancy,
        },
        rig.blockstore,
        [rig.guard],
      )
      const makespanMs = performance.now() - started

      // Immediately after, never before: the reference has to sample the same instant
      // of machine load as the fabric run it is paired with.
      const referenceStarted = performance.now()
      await runReference()
      referenceMs.push(performance.now() - referenceStarted)

      return {
        makespanMs,
        complete: result.ok && result.job.complete,
        grossNodeSeconds: cost.gross,
        usefulNodeSeconds: cost.gross / Math.max(1, config.redundancy),
        verificationMultiplier: result.ok ? result.job.verificationMultiplier : 0,
        // `submitJob` neither speculates nor re-dispatches. Identities, not
        // measurements — the same distinction the driver draws.
        speculationMultiplier: 1,
        redispatches: 0,
        codeCache,
        // **The perf gate deliberately runs no reduce**, and this is a not-measured
        // sentinel rather than a measurement of zero.
        //
        // `bin/bench.ts` gained a reduce leg in Phase 16; this file did not, because
        // its assertions are wall-clock comparisons against the committed numbers in
        // `perf-baseline.ts`. Adding a second timed segment to the run would change
        // what `sweep.makespan` measures relative to a baseline taken without it, and
        // the gate would report a regression that is a change of workload rather than
        // a change of speed. `ok: false` is therefore correct here in the same sense
        // it is correct in the driver: no aggregate was produced, so there is nothing
        // to report — and nothing in this file reads `SweepResult.reduce`.
        reduce: {
          ok: false,
          reduceMs: 0,
          treeDepth: 0,
          combines: 0,
          recomputes: 0,
          combineExecutors: 0,
        },
      } satisfies Observation
    }

    let sweep: SweepResult
    try {
      sweep = await measure(run, gateConfig(nodes), { runs })
    } finally {
      rig.close()
    }

    // `measure` discards the first iteration as cold-cache and reports it separately,
    // so the paired series has to discard the same index rather than the same count.
    const pairs = sweep.observations
      .map((observation, i) => ({ fabric: observation.makespanMs, reference: referenceMs[i] }))
      .slice(1)

    measurements.push({
      sweep,
      reference: summarise(pairs.map((pair) => pair.reference ?? Number.NaN)),
      coordinationRatio: summarise(
        pairs.map((pair) =>
          pair.reference === undefined || pair.reference === 0
            ? Number.NaN
            : pair.fabric / pair.reference,
        ),
      ),
    })
  }

  return measurements
}
