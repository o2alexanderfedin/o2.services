import { cpus, hostname, loadavg } from 'node:os'
import { ed25519 } from '@noble/curves/ed25519.js'
import { hostCount, isSameMachine, machineLabel, measure, summarise } from '@o2/bench'
import type { Observation, RunConfig, SweepResult } from '@o2/bench'
import { MemoryBlockstore, signName, toHex } from '@o2/core'
import type { NameRecord } from '@o2/core'
import { submitJobWithEgress } from '@o2/net'
import { afterEach, describe, expect, it } from 'vitest'
// Test-only relative import — the same one `bench-fabric.node.test.ts` takes, and for the
// same reason: it keeps this file free of a dependency the fixture choice would impose.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { processFabric } from './bench-fabric.ts'
import type { ProcessFabric } from './bench-fabric.ts'
import { inventory } from './bench-inventory.ts'

/**
 * BENCH-06 — a benchmark **ladder** across N real operating-system processes on one host.
 *
 * ## What this file measures, stated before any number appears
 *
 * Each rung spawns `nodes` real `bin/agent.ts` processes. Every one of them binds its own
 * real listening socket on its own OS-assigned TCP port, and every shard that reaches one
 * crosses a real socket, a real Noise handshake and a real serialization boundary. The
 * submitting node stays in this process because it holds the blockstore the module is put
 * into — so the process count at a rung is `nodes + 1`, which is what the inventory below
 * is built with and never `nodes`.
 *
 * **The socket is a loopback socket, and saying so is part of the reading.** `bin/agent.ts`
 * binds `/ip4/127.0.0.1/tcp/0` — never `0.0.0.0` — so the bytes go through the kernel's
 * network stack and its loopback interface, not across a wire. That is a real transport in
 * every sense that separates it from an in-process function call (serialization, framing,
 * a muxer, a Noise session, kernel buffers, scheduler handoffs) and in no sense that
 * involves a NIC, a switch, propagation delay or packet loss. A latency figure taken here
 * is a floor, not a network measurement.
 *
 * ## What it therefore establishes, and what it does not
 *
 * **Establishes:** that the fabric completes a real job when its nodes are separate
 * operating-system processes with separate address spaces, separate heaps, separate V8
 * isolates and separate schedulers, communicating over the loopback network stack rather
 * than over an in-process function call; and how the makespan of that job moves as the
 * process count rises.
 *
 * **Does not establish**, and no reading of the numbers below may assume it:
 *
 * - **Anything across differing hardware, clocks or OS builds.** Every process here shares
 *   one kernel, one CPU, one memory bus, one libc and one V8 build. The variables a
 *   cross-machine benchmark exists to expose are held constant by construction, so a
 *   divergence between two machines *cannot* appear in this measurement — not because it
 *   was not looked for, but because there is only one machine to look at. This is the
 *   standing ruling recorded at `vitest.config.ts:716` applied to the process tier: three
 *   engines on one host are not three machines, and `nodes + 1` processes on one host are
 *   not `nodes + 1` machines either.
 * - **Parallel speedup attributable to independent hardware.** The processes contend for
 *   one CPU. A flat or worsening curve here is a statement about contention on this host,
 *   not about the fabric's scaling on N hosts.
 *
 * The label asserted below says exactly this, and it is **derived** from what the spawned
 * children announced about themselves — never declared by this file. That is the whole
 * mechanism BENCH-06's labelling half rests on: `bin/agent.ts` puts `machine.hostId` on its
 * own handshake line, `processFabric` propagates it off that line, and `machineLabel` reads
 * the set of distinct host ids. A rig that had silently fallen back to in-process nodes
 * would produce a *different* reading here, not the same one.
 *
 * ## Why a ladder rather than one rung
 *
 * A single rung cannot show a curve, and a curve is what BENCH-06 asks for. The ladder is
 * deliberately short — `PROCESS_LADDER` below — because each rung spawns real processes and
 * runs a real job through them, and the cost is minutes rather than milliseconds. The
 * numbers this file prints are a *shape*, taken under stated conditions, not a published
 * headline; `bin/bench.ts` remains the publishing driver.
 *
 * ## Three runs disagreed, and that is recorded rather than smoothed
 *
 * Measured 2026-08-16 on one host, `RUNS_PER_RUNG = 5`, makespan p50 per rung:
 *
 * | run | load1 | 1 worker | 2 workers | 4 workers | ratios vs own 1-worker |
 * |-----|------:|---------:|----------:|----------:|------------------------|
 * | A   |  ~39  | 19.4 ms  | 22.4 ms   | 17.5 ms   | 1.000 / 1.156 / 0.903  |
 * | B   |  ~40  | 18.4 ms  | 15.8 ms   | 24.2 ms   | 1.000 / 0.856 / 1.314  |
 * | C   | ~126  | 54.4 ms  | 64.8 ms   | 82.9 ms   | 1.000 / 1.191 / 1.525  |
 *
 * **The between-run variation exceeds the between-rung variation**, so at this shard size
 * and this sample count the ladder shows no trend — and the file therefore asserts none.
 * Reporting any one run's ordering as a scaling result would be reporting noise, which is
 * the specific failure BENCH-06's labelling half exists to prevent one tier down.
 *
 * **Run C is the useful one, and not for its numbers.** It was taken while an unrelated
 * LLVM build was saturating the machine, and every absolute figure roughly tripled while
 * the rungs kept their relative order to within the noise of A and B. That is the argument
 * for the ratio and against the millisecond, made by measurement rather than by assertion:
 * an absolute threshold written from run A would have failed run C on the machine's weather
 * and said nothing about the code. It is also why `load1` is printed beside every rung —
 * a reading whose conditions are not recorded beside it cannot be compared with anything.
 *
 * Two causes of the flatness, both stated because they bound what a larger run could fix.
 * `RUNS_PER_RUNG` is 5, well under `MIN_RELIABLE_SAMPLES`; and the trivial fixture's shards
 * return almost immediately, so a rung's makespan is dominated by dispatch and round-trip
 * rather than by compute, leaving nothing for more workers to divide. A run that wanted a
 * curve would need the saturating fixture and a real sample count — which is
 * `bin/bench.ts`'s job, not this file's. What this file establishes is that the rungs
 * *run*, over real processes and real sockets, and what they may be labelled when they do.
 */

/**
 * The process counts measured.
 *
 * `1` is the rung the others are read against: one worker process plus the submitter is the
 * smallest configuration that still crosses a real socket, so the ratio between rungs
 * cancels this host's speed, its load on the day, and its I/O weather — which an absolute
 * millisecond figure would silently encode instead. Kept to three rungs because a fourth
 * doubles the file's wall clock and adds no shape the third does not already show.
 */
const PROCESS_LADDER = [1, 2, 4] as const

/**
 * Runs per rung.
 *
 * Well below `RUNS_PER_CONFIG` (20) on purpose, and the shortfall is declared rather than
 * hidden: `MIN_RELIABLE_SAMPLES` in `@o2/bench` exists precisely so a summary taken over
 * too few observations says so, and the assertions below read p50 only — never p95 or p99,
 * which at this sample count would be a single observation wearing a percentile's name.
 */
const RUNS_PER_RUNG = 5

/** Shards per job. Four is the fixture's own partition count in `bench-fabric.node.test.ts`. */
const SHARDS = 4

/** Per-rung budget: spawns, dials, and `RUNS_PER_RUNG` real jobs. */
const RUNG_TIMEOUT_MS = 300_000

/**
 * Seed 71. Distinct from every other fixture key in the repository — 59 is
 * `discovery-agents`, 58 is `tree-reduce-agents`, 57 is `certificate-verification`.
 * Two fixtures sharing a publisher key would couple two files that have nothing to do
 * with each other.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(71)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

async function fixtureRecord(): Promise<NameRecord> {
  const cid = await new MemoryBlockstore().put(MODULE_WRITES_PARTITION)
  return signName(publisher.priv, {
    name: 'bench-process-ladder-fixture',
    cid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

let fabric: ProcessFabric | undefined

/**
 * Inner 10 s, outer 30 s — `stopAgent` gives a wedged process 10 s before SIGKILL, and
 * vitest's default `hookTimeout` is also 10 s, so with no budget here the framework's clock
 * fires first and the SIGKILL fallback can never run.
 */
afterEach(async () => {
  if (fabric !== undefined) await fabric.close().catch(() => {})
  fabric = undefined
}, 30_000)

/** The run config for a rung, with every provenance field the report requires. */
function configFor(nodes: number): RunConfig {
  return {
    nodes,
    shards: SHARDS,
    redundancy: 1,
    transport: 'real',
    skew: 'uniform',
    driver: 'process-per-node',
    fixture: 'trivial',
    leg: 'public',
  }
}

/** One real job across the spawned fabric, timed end to end. */
async function runOneJob(built: ProcessFabric): Promise<Observation> {
  const started = performance.now()
  const result = await submitJobWithEgress(
    {
      moduleCid: built.moduleCid,
      moduleRecord: built.moduleRecord,
      shards: Array.from({ length: SHARDS }, (_unused, a) => ({
        value: { a },
        label: 'public' as const,
      })),
      executors: built.executors,
      nodes: built.nodes,
      redundancy: 1,
      onQuorumShortfall: 'runs-at-available-redundancy',
    },
    built.blockstore,
    [built.guard],
    { checkpoints: 'checkpoints-nothing' },
  )
  const makespanMs = performance.now() - started
  const complete = result.ok && result.job.complete
  return {
    makespanMs,
    complete,
    // Node-seconds are not the claim this file makes and are not read by any assertion
    // below; they are filled from the one quantity actually measured so the `Observation`
    // is well-formed rather than carrying an invented number.
    grossNodeSeconds: (makespanMs / 1000) * built.executors.length,
    usefulNodeSeconds: (makespanMs / 1000) * built.executors.length,
    verificationMultiplier: 1,
    speculationMultiplier: 1,
    redispatches: 0,
    codeCache: 'warm',
    reduce: {
      ok: false,
      reduceMs: 0,
      treeDepth: 0,
      combines: 0,
      recomputes: 0,
      combineExecutors: 0,
    },
  }
}

describe('BENCH-06 — a benchmark ladder across N real OS processes on one host', () => {
  const rungs: { readonly nodes: number; readonly result: SweepResult; readonly hosts: number }[] = []

  for (const nodes of PROCESS_LADDER) {
    it(
      `runs ${RUNS_PER_RUNG} real jobs across ${nodes} spawned agent process(es) over real sockets`,
      async () => {
        const record = await fixtureRecord()
        const built = await processFabric(nodes, MODULE_WRITES_PARTITION, record, {
          trustAnchors: [publisher.pub],
        })
        fabric = built

        // ── the rung really is N processes, and none of them is this one ──────────
        expect(built.agents.length).toBe(nodes)
        expect(new Set(built.agents.map((a) => a.pid)).size).toBe(nodes)
        for (const agent of built.agents) {
          expect(agent.announcedPid).toBe(agent.pid)
          expect(agent.pid).not.toBe(process.pid)
          // Every worker binds its own real listening socket. Without this the rung could
          // be N processes talking over something that is not the network stack, which is
          // the one property separating this measurement from the in-process driver.
          expect(agent.multiaddrs.some((ma) => ma.includes('/tcp/'))).toBe(true)
        }
        // Distinct ports: N processes sharing one socket is not N listening nodes.
        const ports = built.agents.map((agent) => {
          const tcp = agent.multiaddrs.find((ma) => ma.includes('/tcp/')) ?? ''
          return /\/tcp\/(\d+)/.exec(tcp)?.[1] ?? ''
        })
        expect(ports.every((port) => port !== '' && port !== '0')).toBe(true)
        expect(new Set(ports).size).toBe(nodes)

        // ── measure ───────────────────────────────────────────────────────────────
        //
        // `separateColdStart: false`: the fabric is already spawned and dialled by the time
        // the first job runs, so no observation here is a cold start in the sense `measure`
        // means. Discarding one would throw away a fifth of an already-short sample for a
        // property this rung does not have.
        const result = await measure(async () => runOneJob(built), configFor(nodes), {
          runs: RUNS_PER_RUNG,
          separateColdStart: false,
        })

        expect(result.incomplete).toBe(0)
        expect(result.makespan.p50).toBeGreaterThan(0)

        // ── the label, derived from what the children announced ───────────────────
        //
        // `nodes + 1` because the submitting node is in this process. `inventory` folds the
        // driver's own machine in beside the announcements, so a rig on one host collapses
        // to one host id however many children it spawned.
        const observed = inventory(nodes + 1, built.agents.map((a) => a.announcedMachine))
        const hosts = hostCount(observed)
        expect(hosts).toBe(1)
        expect(isSameMachine(observed)).toBe(true)
        expect(machineLabel(observed)).toBe(
          `SAME-MACHINE: ${nodes + 1} nodes on 1 host — a node count, not a machine count`,
        )

        // **The honest ceiling, asserted rather than left to prose.** Every child reports
        // the same kernel and the same CPU as this process. That is what makes the rung
        // one host — and it is exactly why no divergence between machines could appear
        // here: there is one instruction set, one engine build and one system library.
        for (const agent of built.agents) {
          expect(agent.announcedMachine.hostId).toBe(hostname())
          expect(agent.announcedMachine.cpuModel).toBe(cpus()[0]?.model ?? 'unknown')
          expect(agent.announcedMachine.runtime).toBe(`node ${process.version}`)
        }

        rungs.push({ nodes, result, hosts })

        process.stdout.write(
          `[bench-process-ladder] nodes=${nodes} processes=${nodes + 1} ` +
            `p50=${result.makespan.p50.toFixed(1)}ms ` +
            `min=${result.makespan.min.toFixed(1)}ms max=${result.makespan.max.toFixed(1)}ms ` +
            `runs=${result.observations.length} incomplete=${result.incomplete} ` +
            `load1=${loadavg()[0]?.toFixed(2) ?? 'na'} ` +
            `label="${machineLabel(observed)}"\n`,
        )
      },
      RUNG_TIMEOUT_MS,
    )
  }

  it('reports the ladder as a ratio against its own first rung, never as an absolute', () => {
    // Reading the rungs against each other rather than against a threshold: an absolute
    // millisecond bound would encode this machine, its load and its I/O weather on the day
    // it was written, and then fail elsewhere for reasons that have nothing to do with the
    // code. The ratio is taken within one run, which cancels all three.
    expect(rungs.length).toBe(PROCESS_LADDER.length)
    const base = rungs[0]
    if (base === undefined) throw new Error('no base rung')

    const ratios = rungs.map((rung) => ({
      nodes: rung.nodes,
      ratio: rung.result.makespan.p50 / base.result.makespan.p50,
    }))
    process.stdout.write(
      `[bench-process-ladder] makespan p50 relative to ${base.nodes}-worker rung: ` +
        `${ratios.map((r) => `${r.nodes}w=${r.ratio.toFixed(3)}x`).join(' ')}\n`,
    )

    // Every rung produced a finite, positive reading. No claim is made about the *direction*
    // of the curve: on one contended CPU it may rise or fall, and asserting a direction
    // would be asserting a scaling result this rig cannot support.
    for (const { ratio } of ratios) {
      expect(Number.isFinite(ratio)).toBe(true)
      expect(ratio).toBeGreaterThan(0)
    }

    // And the ladder never crossed a host boundary, at any rung.
    expect(rungs.every((rung) => rung.hosts === 1)).toBe(true)

    // The summary over the ladder's own p50s, so the file ends with one number a reader can
    // carry away beside the label that bounds it.
    const across = summarise(rungs.map((rung) => rung.result.makespan.p50))
    process.stdout.write(
      `[bench-process-ladder] across-rung p50-of-p50s=${across.p50.toFixed(1)}ms ` +
        `— ONE KERNEL, ONE HOST: ${PROCESS_LADDER.length} rungs of separate OS processes with ` +
        `separate address spaces, over real TCP sockets on the loopback interface; ` +
        `NOT separate machines, NOT separate clocks, NOT differing OS builds, and NOT a ` +
        `physical network path\n`,
    )
    expect(across.p50).toBeGreaterThan(0)
  })
})
