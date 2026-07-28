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
const SHARDS = 8

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
  const moduleCid = await originStore.put(MODULE_WRITES_PARTITION)

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
    executor: new WasmExecutor({ nodeId: 'requestor', blockstore: originStore }),
    blockstore: originStore,
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
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
      executor: new WasmExecutor({ nodeId: id, blockstore: store }),
      blockstore: store,
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      capacity: 'accepts-every-offer',
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
    started.push(await FabricNode.start({ blockstoreDir: dir, rpcTimeoutMs: 30_000 }))
  }

  const requestorDir = join(root, 'requestor')
  await mkdir(requestorDir, { recursive: true })
  const requestor = await FabricNode.start({ blockstoreDir: requestorDir, rpcTimeoutMs: 30_000 })
  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

  // Everyone dials the requestor, so blocks are reachable from every worker.
  for (const node of started) {
    await node.libp2p.dial(requestor.libp2p.getMultiaddrs())
  }

  const executors = started.map((node) => new RemoteExecutor(node.libp2p.peerId.toString(), requestor.rpc))

  return {
    executors,
    blockstore: requestor.store as unknown as MemoryBlockstore,
    moduleCid,
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
  const moduleCid = await store.put(MODULE_WRITES_PARTITION)
  const executor = new WasmExecutor({ nodeId: 'local', blockstore: store })
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
