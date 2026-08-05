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
  close(): Promise<void>
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

/** Every key this module reads off the handshake. The line carries more. */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly pid: number
}

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

  try {
    // Spawned in parallel: the OS assigns each port, so parallel spawns cannot collide, and
    // a rung of sixteen agents started one at a time would spend the whole rig construction
    // in serial libp2p startups.
    const spawned = await Promise.all(
      Array.from({ length: nodes }, async (_, i) => {
        const dir = join(root, `node-${i}`)
        await mkdir(dir, { recursive: true })
        const agent = await spawnAgent(AGENT_PATH, dir, [...anchorArgs, ...(options.agentArgs ?? [])])
        return { ...agent, dir }
      }),
    )
    for (const { child, handshake, dir } of spawned) {
      children.push(child)
      if (child.pid === undefined) throw new Error(`an agent in ${dir} was spawned without a pid`)
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
      })
    }

    const submitterDir = join(root, 'submitter')
    await mkdir(submitterDir, { recursive: true })
    submitter = await FabricNode.start({
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
    })

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

    // **The submitter dials outward**, matching every existing spawn harness in this
    // package. `realFabric` has it the other way — each worker dials the requestor — so
    // adopting this shape changes *two* things at once: the process split and the dial
    // direction. Only the first is what BENCH-07 is about. The direction decides which side
    // receives the inbound connections, which is a controlled variable rather than a
    // detail, and it is measured by holding this rig fixed while varying it. Nothing here
    // states how many inbound connections either side ends up with, or whether the per-host
    // inbound cap binds: those are quantities to measure, not to reason about, and
    // `Libp2pTransport.send` reuses an existing connection whichever side opened it, so the
    // direction changes who accepts rather than how a dispatch reaches a peer.
    for (const agent of agents) {
      const address = agent.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
      if (address === undefined) throw new Error(`no dialable address on the agent in ${agent.dir}`)
      await submitter.dial(address)
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
