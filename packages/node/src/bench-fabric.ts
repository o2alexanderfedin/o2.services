/**
 * A benchmark rig whose nodes are real operating-system processes — BENCH-07.
 *
 * `bin/bench.ts` builds every node of both published curves inside its own process:
 * `realFabric` calls `FabricNode.start` in a loop, so N libp2p nodes share one V8 isolate
 * and one event loop, and `WasmExecutor.execute` is synchronous CPU work inside that loop.
 * This module is the third rig, in which "N nodes" means N processes and the claim is
 * checkable: each child announces its own pid on the handshake line `bin/agent.ts` already
 * prints, and the fabric carries the pid the parent was handed beside it.
 *
 * ## Why this is a module and not more code in `bin/bench.ts`
 *
 * That file executes `await main()` on import, so nothing in it can be called by a test —
 * every guard over it is a source-text read or a spawn with a temporary `cwd`. A fabric
 * that spawns real processes deserves a test that spawns real processes, which is the
 * difference between "the wiring is written down" and "the wiring works". See
 * `bench-fabric.node.test.ts`, which drives a real job across two spawned agents.
 *
 * ## Every node here is the same node
 *
 * Nothing in this file keys on a kind of node, and `bin/agent.ts` says the same about
 * itself at every one of its sixteen flags: *every agent process built by this binary has
 * identical capability regardless of whether it is passed*. The submitting node is a
 * **position in this rig** — it holds the module first and it dials outward — exactly as
 * `Machine.roles` already models role as data. It is a `FabricNode`, which is the same
 * class the children run.
 *
 * ## Node-only by necessity
 *
 * It spawns processes and writes directories. `purity.node.test.ts` scans `PORTABLE`
 * (`core`, `net`, `bench`, `demo`, `aot`) and `DUAL_TARGET` (`libp2p`, `browser`);
 * `packages/node` is in neither, which is what makes `node:child_process` permissible here
 * and not inside `@o2/bench`.
 *
 * ## This is the fourth copy of `spawnAgent`, and that is deliberate
 *
 * Roughly twenty node-tier specs each declare their own, all of the same shape;
 * `two-process.node.test.ts` and `sovereignty-placement.node.test.ts` carry byte-identical
 * bodies. It is copied rather than imported because `bin/bench.ts` cannot import from a
 * `*.node.test.ts`. Lifting the other copies onto this export is attractive and is
 * deferred: a shared export needs a production caller to be reachable at all, the
 * benchmark driver would be the only one, and that is the conversation Phase 22 owns.
 * Named here so the duplication is scheduled rather than unnoticed.
 */

import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { publicNodes } from '@o2/core'
import type { AdmissionControl, Blockstore, Executor, NameRecord, NodeDescriptor } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import type { CombineTrustAnchors, EgressGuard, RpcEndpoint } from '@o2/net'
import { FabricNode } from './fabric-node.ts'

/**
 * The seam a benchmark rig implements, moved here from `bin/bench.ts` so a rig can be
 * built and tested outside a file that runs on import.
 *
 * Ten members. Two are deliberately wider than the copy in `bin/bench.ts`:
 * {@link Fabric.blockstore} is `Blockstore` rather than `MemoryBlockstore`, which deletes
 * `realFabric`'s `as unknown as MemoryBlockstore` cast at the point a driver imports this
 * type, and {@link Fabric.moduleCid} follows it. Naming `CID` directly is avoided by the
 * same `Awaited<ReturnType<…['put']>>` idiom the original uses, so `@o2/node` needs no
 * direct `multiformats` dependency for it.
 */
export interface Fabric {
  readonly executors: readonly Executor[]
  /**
   * The descriptors placement ranks over, correlated with {@link Fabric.executors} by
   * `nodeId`.
   *
   * Carried on the rig rather than derived by the caller, because different arms derive it
   * differently and only the rig knows which arm it is: a default rig uses
   * `publicNodes(executors)`, while a discovering rig uses the descriptors
   * `discoverCandidates` returned — which carry a real `ownerId` and `canExecuteSovereign`
   * read off each node's signed capability record, rather than the public placeholder
   * `publicNodes` synthesises.
   */
  readonly nodes: readonly NodeDescriptor[]
  readonly blockstore: Blockstore
  readonly moduleCid: Awaited<ReturnType<Blockstore['put']>>
  /**
   * DET-03: what vouches for {@link Fabric.moduleCid} to this rig's nodes. Attached to the
   * `JobSpec`, so every `Task` `submitJob` builds carries it. **Without it every rig
   * refuses every shard** — a spawned worker has no other way to learn that the module it
   * is being asked to run was meant to run.
   */
  readonly moduleRecord: NameRecord
  /**
   * Wraps the submitting node's outbound transport — DATA-05/DATA-06's production wiring,
   * reused rather than bypassed. The submitter is the only node whose RPC connection
   * dispatches shards in this rig, so this is the one guard whose manifest is interesting.
   */
  readonly guard: EgressGuard
  /**
   * The submitting node's own endpoint — the one every `RemoteExecutor` is built over, and
   * the one a combine is dispatched from.
   *
   * Surfaced rather than reconstructed, for the same reason {@link Fabric.guard} is: a
   * second endpoint would be a second peer as far as the workers are concerned, and combine
   * nodes fetch their leaves back through *this* one's `serveAgent`.
   */
  readonly rpc: RpcEndpoint
  /**
   * How placement asks a candidate whether it will take a shard — SCHED-02/SCHED-03.
   *
   * **Absent, not `undefined`**, on any rig that must place with `planPlacement`:
   * `submitJob` branches on `spec.admit === undefined`, and under
   * `exactOptionalPropertyTypes` an explicit `undefined` and an absent key are different
   * types reaching the same branch by accident rather than by statement.
   */
  readonly admit?: AdmissionControl
  /**
   * The issuers this rig's submitter accepts a **combine** certificate from — VER-08,
   * VER-09, VER-10.
   *
   * The same set the rig already pins, resolved once, never a second copy. On a rig that
   * pins nothing this is the no-checking literal, which is the truthful reading rather than
   * a placeholder: no provider process exists, no node is enrolled, and there is no
   * signature to check.
   */
  readonly combineIssuers: CombineTrustAnchors
  /**
   * The configuration the submitting node **ended up with**, and how many connections it
   * is holding — read off the live node at the moment of the call, never remembered.
   *
   * BENCH-07 criterion 3. Optional, and absent on {@link Fabric} implementations with no
   * libp2p node behind them: `memoryFabric` builds its executors directly and has no node
   * whose limits could be read, and an absent function is the truthful reading of that
   * rather than three zeros a reader would take for measurements.
   *
   * A function rather than three fields, because the connection count is only meaningful
   * at a stated moment. The two limits do not move after start; the count does.
   */
  readonly submitterReading?: () => SubmitterReading
  close(): Promise<void>
}

/** What a rig can say about the node the driver itself holds. See {@link Fabric.submitterReading}. */
export interface SubmitterReading {
  /** Read off the node's own getter, never restated from the options that built it. */
  readonly inboundConnectionThreshold: number
  /** The same. Derived from the reservation limit unless a caller pinned it. */
  readonly maxIncomingPendingConnections: number
  /**
   * `libp2p.getConnections().length` at the moment of the call.
   *
   * **The only connection population this rig can measure.** The agents are child processes
   * and nothing announces their counts, so a caller must record the agents' inbound counts
   * as *not instrumented* rather than infer them from this one.
   */
  readonly connections: number
}

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type — see {@link spawnAgent}.
 */
export type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * One spawned agent, as the benchmark driver's integrity check needs to read it.
 *
 * {@link AgentHandle.pid} and {@link AgentHandle.announcedPid} are two readings of what
 * ought to be one number, and keeping them apart is the whole mechanism: the first is what
 * `spawn` returned to this process, the second is what the process on the far end of the
 * handshake said about itself. A rig that had silently fallen back to in-process nodes
 * would have a plausible answer for each and no way to make them agree.
 */
export interface AgentHandle {
  /** What `spawn` returned to this process. */
  readonly pid: number
  /** What the spawned binary printed about itself on its handshake line. */
  readonly announcedPid: number
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly dir: string
  /**
   * The inbound rate limit this agent **ended up with**, read off its own started node.
   *
   * BENCH-07 criterion 3. Carried on the handle rather than restated from the options that
   * built the rig, because those are two different facts and only one of them is a
   * measurement: a limit that is derived rather than set is exactly the case that produced
   * the published exclusion's stale constant. A caller that reports what it passed instead
   * of what the agent announced reproduces that defect at the reporting layer.
   */
  readonly inboundConnectionThreshold: number
  /** The same, for the pending-handshake count. Derived from the same reservation limit. */
  readonly maxIncomingPendingConnections: number
  /**
   * The host this agent said it was running on — BENCH-06.
   *
   * **Read off the handshake and never off this process**, the same rule as
   * {@link AgentHandle.announcedPid} directly above and for a stronger reason. The
   * driver's published inventory is built by merging these, and the SAME-MACHINE label is
   * derived from how many distinct `hostId`s that merge produced. Filling it from the
   * parent's own `hostname()` would make every rig look same-machine whatever it was, so
   * the label would be true by construction — a declaration wearing a derivation's
   * clothes, which is precisely the defect BENCH-06 names.
   */
  readonly announcedMachine: AnnouncedMachine
  /**
   * The peer ids this agent reached before it announced, `[]` when it was told to reach
   * nobody.
   *
   * Non-empty only under {@link ProcessFabricOptions.dial} `'workers-to-submitter'`, where
   * it holds the submitting node's peer id — which is how a caller knows the inverse
   * direction actually happened rather than was merely requested.
   */
  readonly peers: readonly string[]
}

/**
 * A {@link Fabric} whose workers are operating-system processes.
 *
 * {@link ProcessFabric.agents} rides on the rig rather than being re-derived by a caller
 * because a caller has no other way to learn a child's *announced* pid — it is read once,
 * off a line that is written once.
 */
export interface ProcessFabric extends Fabric {
  readonly agents: readonly AgentHandle[]
  /**
   * The submitting node's peer id.
   *
   * Carried so a caller can state that the driver's own node is not among the executors
   * without re-deriving it. It is a position rather than a class — this node serves `exec`
   * requests like any other, it simply is not dispatched to by this rig.
   */
  readonly submitterPeerId: string
}

/**
 * What one agent said about the host it is running on — BENCH-06.
 *
 * Six measurements and nothing else. `roles` and `physicalCores`, which `@o2/bench`'s
 * `Machine` also carries, are absent on purpose: neither is something the announcing
 * process can read. See the key's own comment in `bin/agent.ts`.
 *
 * Exported because the driver's inventory is built from these and that construction has to
 * live somewhere a test can call it — `bin/bench.ts` runs `main()` on import.
 */
export interface AnnouncedMachine {
  readonly hostId: string
  readonly cpuModel: string
  readonly logicalCores: number
  readonly totalMemoryBytes: number
  readonly os: string
  readonly kernel: string
  readonly runtime: string
}

/** Every key this module reads off the handshake. The line carries more. */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly pid: number
  readonly machine: AnnouncedMachine
  readonly inboundConnectionThreshold: number
  readonly maxIncomingPendingConnections: number
  readonly peers: readonly string[]
}

/**
 * Which side of this rig opens the connections — a controlled variable, never a detail.
 *
 * `'submitter-to-workers'` is what Plan 23-02 built and what every published process-driver
 * number was taken under: the submitting node dials each agent, matching every spawn
 * harness in this package. `'workers-to-submitter'` is what `realFabric` does and what the
 * excluded real-transport rung was measured under — N peers on one host opening connections
 * to one node.
 *
 * The direction decides **which side receives** the inbound connections, and nothing else:
 * `Libp2pTransport.send` reaches a peer by peer id and reuses an existing connection
 * whichever end opened it, so a dispatch arrives identically either way. That is what makes
 * this separable from the process split, and separating them is what criterion 3 asks for —
 * adopting the spawn pattern changed both at once, and only one of them is what BENCH-07 is
 * about.
 */
export type DialDirection = 'submitter-to-workers' | 'workers-to-submitter'

/** The binary each worker process runs. The same one every node-tier spawn site uses. */
const AGENT_PATH = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** How long a spawned agent gets to announce before the wait is abandoned. */
const HANDSHAKE_BUDGET_MS = 30_000

/** How long a stopping agent gets between SIGTERM and SIGKILL. */
const STOP_BUDGET_MS = 10_000

/**
 * Spawn one `bin/agent.ts` and resolve its single announcement line.
 *
 * ## `stdio[0]` is `'pipe'` and must never be `'ignore'`
 *
 * fd 0 is this repository's orphan leash: the child watches it and leaves when it closes,
 * which is what stops an agent outliving a parent that was killed rather than asked.
 * `'ignore'` puts `/dev/null` there, `/dev/null` is a character device, the leash does not
 * arm, and the agents survive — silently, with nothing failing anywhere.
 * `orphan-leash.node.test.ts` demonstrates that and guards every spawn site against it.
 *
 * ## State `--port 0` the moment a caller also states `--relay-addr`
 *
 * `bin/agent.ts`'s `listen` table has three rows, and the third is keyed on `--port` being
 * *absent*: with `--relay-addr` given and no `--port`, the listen list is empty, the agent
 * binds nothing, the submitter has nothing to dial, and **no error is raised anywhere**.
 * The three pre-existing sites that pass `--relay-addr` all already state `--port 0`
 * (`reservation-exhaustion.node.test.ts`). This fabric passes no `--relay-addr` today, so a
 * bare `--dir` spawn takes row two and binds `/ip4/127.0.0.1/tcp/0` exactly as it always
 * did — the rule is written down because a later caller of `agentArgs` will need it.
 *
 * ## No `env` override
 *
 * Recorded as a decision rather than left as an oversight: every agent is a local process
 * started by the same user, on the same host, running the same binary, which is what the
 * existing spawn harnesses do and what keeps a spawned node identical to an in-process one
 * in everything except which process it is.
 *
 * ## A spawn that fails stops the process it spawned
 *
 * The handshake can reject three ways — the budget elapsed, the line would not parse, or the
 * child exited before it spoke — and on the first two the child is **still running**. It was
 * returned to nobody, so nobody can stop it, and it outlives the run. Measured rather than
 * reasoned about: a rung whose agents dialled inward left **twenty** agent processes resident
 * on this host and the driver alive on their handles long after it had written its report.
 * The stop is best-effort, because the failure being reported is the interesting one.
 */
export async function spawnAgent(
  agentPath: string,
  dir: string,
  extraArgs: readonly string[] = [],
): Promise<{ readonly child: AgentProcess; readonly handshake: Handshake }> {
  const child: AgentProcess = spawn(process.execPath, [agentPath, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const handshake = await new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent in ${dir} did not announce in time: ${stderr}`)),
      HANDSHAKE_BUDGET_MS,
    )
    let stdout = ''
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as Handshake)
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    // An early exit becomes a legible failure carrying the child's stderr, rather than a
    // wait that ends at the budget with nothing to say. `refuse` writes there, and so does
    // a crash.
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent in ${dir} exited early with ${String(code)}: ${stderr}`))
    })
  }).catch(async (cause: unknown): Promise<never> => {
    // See the header. A child that never announced was handed to nobody, so this is the
    // only place that still holds it.
    await stopAgent(child).catch(() => {})
    throw cause instanceof Error ? cause : new Error(String(cause))
  })

  return { child, handshake }
}

/** SIGTERM, then wait for the process to actually be gone, SIGKILL at the budget. */
export async function stopAgent(child: AgentProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, STOP_BUDGET_MS)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

export interface ProcessFabricOptions {
  readonly rpcTimeoutMs?: number
  readonly maxConcurrentTasks?: number
  /**
   * DET-03/DATA-08 build authorities, pinned on the submitting node **and passed to every
   * child on argv**.
   *
   * A spawned child gets its anchors only from argv. Without them it keeps `bin/agent.ts`'s
   * default — the demo's committed anchor — and refuses every shard of a job signed by
   * anybody else, which is a whole-rig silent zero rather than an error.
   */
  readonly trustAnchors?: readonly string[]
  /** Passed through to every spawned agent. See {@link spawnAgent} on `--port 0`. */
  readonly agentArgs?: readonly string[]
  /**
   * The inbound rate limit pinned on **every spawned agent**, or absent to let each derive
   * its own — BENCH-07 criterion 3.
   *
   * One option, one flag (`--inbound-threshold`), one announced reading on each
   * {@link AgentHandle}. There is deliberately no second way to pass the same thing: a rig
   * with two routes to one limit is a rig whose published configuration has two answers.
   */
  readonly inboundThreshold?: number
  /**
   * The inbound rate limit pinned on the **submitting** node, or absent to let it derive
   * its own.
   *
   * Separate from {@link ProcessFabricOptions.inboundThreshold} for a reason that is
   * structural rather than stylistic: under `'workers-to-submitter'` the node that receives
   * every dial is the one this function starts *in the driver's own process*, and an
   * agent-side flag cannot reach it. Pinning the cap on the side that does not receive the
   * connections would be an attempt that exercised nothing.
   */
  readonly submitterInboundThreshold?: number
  /**
   * Which side opens the connections. See {@link DialDirection}.
   *
   * Defaults to `'submitter-to-workers'` — what this rig has always done, and what every
   * process-driver figure already published was taken under, so an existing caller that
   * omits it builds exactly what it built before.
   */
  readonly dial?: DialDirection
}

/** The first TCP address of a set that a peer can actually dial. */
function dialable(multiaddrs: readonly string[], what: string): string {
  const address = multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (address === undefined) throw new Error(`no dialable address on ${what}`)
  return address
}

/**
 * Build a fabric of `nodes` real agent processes plus one submitting node in this process.
 *
 * The module bytes and the signed record are **parameters** rather than an imported
 * fixture: the fixture choice belongs to the caller, a rig that hard-coded one could not
 * serve two fixtures, and the record has to come from whoever holds the signing key.
 *
 * The observed process count at a rung is therefore `nodes + 1`, not `nodes` — the
 * submitting node stays in this process because it must hold the store the module is `put`
 * into, expose the `EgressGuard` the manifest is read off, and own the `RpcEndpoint` every
 * `RemoteExecutor` is built over. Moving it into a child would need an RPC to retrieve the
 * manifest, which is deferred rather than needed.
 */
export async function processFabric(
  nodes: number,
  moduleBytes: Uint8Array<ArrayBuffer>,
  moduleRecord: NameRecord,
  options: ProcessFabricOptions = {},
): Promise<ProcessFabric> {
  const root = await mkdtemp(join(tmpdir(), 'o2-bench-proc-'))
  const trustAnchors = options.trustAnchors ?? []
  const anchorArgs = trustAnchors.flatMap((anchor) => ['--trust-anchor', anchor])
  const children: AgentProcess[] = []
  const agents: AgentHandle[] = []
  let submitter: FabricNode | undefined

  /** Release everything acquired so far, in the order {@link close} would. */
  const undo = async (): Promise<void> => {
    for (const child of children) await stopAgent(child).catch(() => {})
    if (submitter !== undefined) await submitter.stop().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }

  const direction: DialDirection = options.dial ?? 'submitter-to-workers'
  const inboundArgs =
    options.inboundThreshold === undefined
      ? []
      : ['--inbound-threshold', String(options.inboundThreshold)]

  /**
   * Spawn every agent **at once**, with `extra` appended to each one's argv.
   *
   * Parallel because the OS assigns each port, so parallel spawns cannot collide, and a rung
   * of sixteen agents started one at a time would spend the whole rig construction in serial
   * libp2p startups. Under `'workers-to-submitter'` the parallelism is not an optimisation
   * but **the mechanism**: it is what makes N dials to one node concurrent, and a per-second
   * per-host rate limit is only observable against concurrent dials.
   */
  const spawnAll = async (extra: readonly string[]): Promise<void> => {
    // **`allSettled` and not `all`, and every child registered the instant it exists.**
    // Measured, not reasoned about: `Promise.all` rejects on the first failure and discards
    // every value its siblings resolved with, so children that started perfectly well were
    // never reachable by `undo` — a rung whose sixteen agents dialled inward left twenty
    // agent processes resident and the driver alive on their handles ten minutes past its
    // own report. `allSettled` waits for every spawn to settle, so by the time the first
    // failure is re-thrown, `children` holds every process that exists.
    const settled = await Promise.allSettled(
      Array.from({ length: nodes }, async (_, i) => {
        const dir = join(root, `node-${i}`)
        await mkdir(dir, { recursive: true })
        const agent = await spawnAgent(AGENT_PATH, dir, [
          ...anchorArgs,
          ...inboundArgs,
          ...extra,
          ...(options.agentArgs ?? []),
        ])
        children.push(agent.child)
        return { ...agent, dir }
      }),
    )
    const refused = settled.find((outcome) => outcome.status === 'rejected')
    if (refused !== undefined && refused.status === 'rejected') {
      // The first failure, re-thrown as itself so a caller reads which agent refused and
      // why, rather than an aggregate naming sixteen.
      throw refused.reason instanceof Error ? refused.reason : new Error(String(refused.reason))
    }
    const spawned = settled.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? [outcome.value] : [],
    )
    for (const { child, handshake, dir } of spawned) {
      if (child.pid === undefined) throw new Error(`an agent in ${dir} was spawned without a pid`)
      // BENCH-06, and it sits beside the pid guard because it defends the same kind of
      // thing: a handle whose facts are absent rather than wrong. The parse above is a
      // cast, so an agent binary that announced no `machine` — or announced one with a
      // blank `hostId` — would put `undefined`, or a phantom host, into the driver's
      // inventory. Both inflate or corrupt `hostCount`, and `hostCount` is the single
      // quantity the SAME-MACHINE label is derived from. A named throw here is cheaper
      // than a published label that is quietly wrong.
      const announced: AnnouncedMachine | undefined = handshake.machine
      if (typeof announced?.hostId !== 'string' || announced.hostId.length === 0) {
        throw new Error(
          `the agent in ${dir} announced no host identity, so nothing about which machine ` +
            'it ran on could be published',
        )
      }
      agents.push({
        pid: child.pid,
        // Read off the handshake, never from `child.pid`. Filling this from the parent's
        // own reading would make `announcedPid === pid` true by construction and turn every
        // caller's integrity check into a tautology — which is exactly the fallback the
        // check exists to catch.
        announcedPid: handshake.pid,
        peerId: handshake.peerId,
        multiaddrs: handshake.multiaddrs,
        dir,
        // The same rule as `announcedPid`, applied to the configuration: read off what the
        // agent said about its own started node, never restated from `inboundArgs` above.
        inboundConnectionThreshold: handshake.inboundConnectionThreshold,
        maxIncomingPendingConnections: handshake.maxIncomingPendingConnections,
        // The same rule again, and the one place it matters most — see the field's docblock.
        announcedMachine: announced,
        peers: handshake.peers,
      })
    }
  }

  /** The submitting node, and the module in its store. Identical under both directions. */
  const startSubmitter = async (): Promise<FabricNode> => {
    const submitterDir = join(root, 'submitter')
    await mkdir(submitterDir, { recursive: true })
    return FabricNode.start({
      // AUTH-02 — open, and this rig's posture is stated in **two** files because the rig
      // is made of two kinds of thing. This node is the in-process half; the N children are
      // `bin/agent.ts` processes, and the posture they start with is written at that
      // binary's own construction site. **Plan 24-03 owns that half** — it is the binary
      // every cross-process proof in this repository spawns, and giving it a way to state a
      // closed posture is that plan's task 2A. Nothing here may be read as having decided
      // for it.
      //
      // The decision at *this* line, on Plan 24-02's rule: a site standing up a measurement
      // fixture may hold the door open and must say so. It binds a loopback address, so it
      // runs a relay service — and, measured, **no node in either bench rig is ever given
      // `relayAddrs`**, so that service is never asked for a reservation and its store is
      // empty for the whole run. So BENCH-07's process-per-node figures were taken over a
      // fabric in which the reservation path was never exercised. They are a usable
      // "before" reading for exactly that reason, and they support no claim whatever about
      // who a relay that pinned issuers would have admitted.
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: submitterDir,
      listen: ['/ip4/127.0.0.1/tcp/0'],
      rpcTimeoutMs: options.rpcTimeoutMs ?? 30_000,
      // The same anchors the children were given rather than a different set: a submitter
      // declaring a different build authority from the nodes it dispatches to would be a
      // statement nobody would re-read. Nothing executes on this node — every executor here
      // is remote — so it states an intent rather than gating anything.
      trustAnchors: [...trustAnchors],
      ...(options.maxConcurrentTasks === undefined
        ? {}
        : { maxConcurrentTasks: options.maxConcurrentTasks }),
      // BENCH-07 criterion 3. Pinned here and not through `agentArgs`, because under
      // `'workers-to-submitter'` this is the node that receives every dial and it lives in
      // the driver's process — no flag on a child could reach it.
      ...(options.submitterInboundThreshold === undefined
        ? {}
        : { inboundConnectionThreshold: options.submitterInboundThreshold }),
    })
  }

  try {
    if (direction === 'workers-to-submitter') {
      // **Submitter first, then all N agents at once.** The ordering is the whole mechanism
      // rather than a consequence: the agents cannot be told where to dial until the node
      // they are dialling exists, and spawning them in parallel is what makes their dials
      // concurrent. `--peer-addr` dials after `FabricNode.start` resolves and strictly
      // before the handshake line is written, so a spawn that resolves is a dial that
      // already succeeded, and a dial that fails rejects the spawn with the child's stderr
      // instead of a rig that quietly has one fewer peer.
      submitter = await startSubmitter()
      await spawnAll(['--peer-addr', dialable(submitter.multiaddrs, 'the submitting node')])
    } else {
      await spawnAll([])
      submitter = await startSubmitter()
    }

    const moduleCid = await submitter.store.put(moduleBytes)
    if (moduleCid.toString() !== moduleRecord.cid.toString()) {
      // One named throw instead of a whole-rig silent zero. A record naming other bytes
      // has every shard refused as a `cid-mismatch`, and the rig reports an incomplete run
      // with no clue as to why — the same failure `sameFixtureCid` exists to convert in
      // `bin/bench.ts`, restated here because this rig takes both from a caller.
      throw new Error(
        `the submitting node addressed the module as ${moduleCid.toString()} but the signed ` +
          `record names ${moduleRecord.cid.toString()} — every shard would be refused as a cid-mismatch`,
      )
    }

    // **The submitter dials outward** under the default direction, matching every existing
    // spawn harness in this package, and dials nobody under the inverse one — where the
    // agents have already dialled it. Nothing here states how many inbound connections
    // either side ends up with, or whether the per-host cap binds: those are quantities to
    // measure, and `bin/bench.ts`'s criterion-3 block is where they are measured.
    if (direction === 'submitter-to-workers') {
      for (const agent of agents) {
        await submitter.dial(dialable(agent.multiaddrs, `the agent in ${agent.dir}`))
      }
    }

    // AUTH-03: the unauthenticated sentinel is the correct value for this rig rather than a
    // placeholder — every shard a public benchmark curve submits is `label: 'public'`, so
    // there is no owner and no root key a capability chain could be rooted at. A rig that
    // dispatches owner-labelled shards is a separate, opt-in leg.
    const executors: readonly Executor[] = agents.map(
      (agent) => new RemoteExecutor(agent.peerId, (submitter as FabricNode).rpc, 'dispatches-unauthenticated'),
    )

    const held = submitter
    return {
      executors,
      nodes: publicNodes(executors),
      blockstore: held.store,
      moduleCid,
      moduleRecord,
      // `FabricNode.start` already wraps its transport in an `EgressGuard` and builds `rpc`
      // over that wrapper — nothing to construct here, only to surface.
      guard: held.egress,
      rpc: held.rpc,
      // **No `admit` key at all.** Not `admit: undefined`: under
      // `exactOptionalPropertyTypes` those are different types, and `submitJob` branches on
      // `spec.admit === undefined` to choose `planPlacement` over `planWithOffers`. An
      // absent key is this rig stating that it places the way the published curve places.
      //
      // VER-08/09/10 — this rig pins nothing. No provider process exists, no node is
      // enrolled, and there is no combine signature to check, so it says so.
      combineIssuers: 'checks-no-combine-signatures',
      // Read at the moment of the call off the live node, so a caller that asks after a
      // rung is reading that rung's population rather than a remembered one.
      submitterReading: () => ({
        inboundConnectionThreshold: held.inboundConnectionThreshold,
        maxIncomingPendingConnections: held.maxIncomingPendingConnections,
        connections: held.libp2p.getConnections().length,
      }),
      agents,
      submitterPeerId: held.peerId,
      async close() {
        // Agents first, then the submitting node, then the directory — and every step
        // tolerant of a participant that has already left, so one dead agent cannot strand
        // the rest. A rung disposed before the next is built is what keeps an earlier
        // rung's idle heaps out of a later rung's measurement.
        for (const child of children) await stopAgent(child).catch(() => {})
        await held.stop().catch(() => {})
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (cause) {
    await undo()
    throw cause
  }
}
