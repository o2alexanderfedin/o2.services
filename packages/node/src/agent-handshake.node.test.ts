import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * BENCH-07 — the process that announced an address is the process the parent spawned.
 *
 * ## What `child.pid` does not say
 *
 * A parent that spawns `bin/agent.ts` and reads the handshake line holds two facts that
 * look like one: it started *a* process, and it read *an* address. Nothing connects them.
 * A harness that fell back to starting nodes inside its own process — the exact failure
 * the multi-process benchmark driver has to refuse rather than report a curve about —
 * would still have a `child.pid` for something, and would still read an address from
 * somewhere. Both readings survive the fallback, so neither of them is the check.
 *
 * The correspondence is the check, and it costs one key on a line the binary already
 * writes: the announcing process states its own `process.pid`, and the parent compares it
 * with the pid it was given by `spawn`.
 *
 * ## Why the assertion is an equality and not a presence test
 *
 * `toBeDefined()` and `toBeGreaterThan(0)` both pass against a constant. The whole content
 * of the claim is *which* process is speaking, so the only assertion that carries it is
 * `toBe(child.pid)` — and that is what a planted `pid: 0` reddens where the weaker forms
 * would not.
 *
 * ## The backwards-compatibility half is checked here rather than assumed
 *
 * `peerId` and `multiaddrs` are read off the same parsed line, because the argument for a
 * one-line addition being additive is that every existing parent still finds what it
 * names. That argument is cheap to state and cheap to check, so it is checked.
 *
 * ## The two inbound limits are asserted as a relationship, never at a value
 *
 * BENCH-07 criterion 3's published exclusion names `INBOUND_CONNECTION_THRESHOLD = 5` as
 * the cause of a rung that died. A default node does not necessarily run at five: it derives
 * both inbound limits from its reservation limit, and that coupling landed *after* the run
 * whose exclusion names the constant. What the effective figure actually is was recorded as
 * **unverified** by this phase's context pass, on the ground that reading it needs a live
 * node.
 *
 * So this file spawns one and reads it, and asserts only what the shared derivation implies
 * without predicting either value: both are positive integers and they are equal to each
 * other. Asserting a number here would be a test of a memory — and if the derivation moves,
 * it fails for a reason about nothing.
 *
 * The one value that *is* asserted is 5, on an agent given `--inbound-threshold 5`, because
 * that one is a value the caller stated rather than one the node derived.
 *
 * Node-only by necessity: the subject is an operating-system process.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type. `bin/agent.ts` watches fd 0 and leaves when
 * it closes; `'ignore'` would put `/dev/null` there and silently opt this file out of the
 * leash. See `orphan-leash.node.test.ts`, which demonstrates that and guards this line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/** Every key this file reads. The line carries more; a reader takes what it names. */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly pid: number
  /** Read off the started node's own getter, never restated from the flags. */
  readonly inboundConnectionThreshold: number
  /** The same, and coupled to it by the node factory's shared derivation. */
  readonly maxIncomingPendingConnections: number
  /**
   * The peer ids this process reached through `--peer-addr`, before it announced.
   *
   * **Pre-existing, and read here because the criterion-3 factorial rests on it.** Plan
   * 23-04 specified a new `--dial` flag with a new `dialed` array for exactly this; the
   * flag it describes is this one, already shipped, already dialling before the handshake
   * and already reporting peer ids read off the `Connection`. A second flag meaning the
   * same thing would be a field with two answers, which is the defect `fabric-node.ts`'s
   * `ownRecords` docblock exists to name.
   */
  readonly peers: readonly string[]
  /**
   * BENCH-06 — the host this process is running on, stated by the process running on it.
   *
   * Six measurements and no `roles` or `physicalCores`: neither is something an agent can
   * read about itself, and both are filled by the driver. See `bench-inventory.ts`.
   */
  readonly machine: {
    readonly hostId: string
    readonly cpuModel: string
    readonly logicalCores: number
    readonly totalMemoryBytes: number
    readonly os: string
    readonly kernel: string
    readonly runtime: string
  }
}

let workdir: string
/** Every agent this file spawned, torn down in `afterEach` whatever the case did. */
let children: AgentProcess[] = []
/** The in-process node the dial cases aim at, stopped in `afterEach`. */
let target: FabricNode | undefined

/**
 * Spawn one agent and resolve its single announcement line.
 *
 * No `--port`: with no `--relay-addr` either, `bin/agent.ts`'s `listen` table binds
 * `/ip4/127.0.0.1/tcp/0`, which is what the `/tcp/` assertion below reads. The rule that
 * would apply here if this file grew a relay flag is stated in `bench-fabric.ts`.
 */
async function spawnAgent(
  dir: string,
  extraArgs: readonly string[] = [],
): Promise<{ child: AgentProcess; handshake: Handshake }> {
  const spawned: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(spawned)

  const handshake = await new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the agent did not announce in time: ${stderr}`)), 30_000)
    let stdout = ''
    let stderr = ''
    spawned.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    spawned.stdout.on('data', (chunk: Buffer) => {
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
    // An early exit is turned into a legible failure rather than a hang, and it carries
    // the child's stderr — which is where `refuse` writes and where a crash lands.
    spawned.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the agent exited early with ${String(code)}: ${stderr}`))
    })
  })

  return { child: spawned, handshake }
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(agent: AgentProcess): Promise<void> {
  if (agent.exitCode !== null || agent.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      agent.kill('SIGKILL')
      resolve()
    }, 10_000)
    agent.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    agent.kill('SIGTERM')
  })
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-agent-handshake-'))
})

/**
 * Inner 10 s, outer 20 s — and the order is the point.
 *
 * `stopAgent` gives a wedged process 10 s before SIGKILL. Vitest's default `hookTimeout`
 * is also 10 s, so with no explicit budget the framework's clock fires first, the SIGKILL
 * fallback never runs, and a wedged agent is reported as an anonymous hook timeout naming
 * no step. The same reasoning `two-process.node.test.ts` records for its own teardown.
 */
afterEach(async () => {
  for (const spawned of children) await stopAgent(spawned).catch(() => {})
  children = []
  if (target !== undefined) await target.stop().catch(() => {})
  target = undefined
  await rm(workdir, { recursive: true, force: true })
}, 30_000)

describe('BENCH-07 — an agent states its own process id on the line it already prints', () => {
  it('announces a pid equal to the pid its parent was handed, alongside the keys every existing reader takes', async () => {
    const spawned = await spawnAgent(join(workdir, 'a'))
    const child = spawned.child
    const { handshake } = spawned

    // The premise, stated rather than assumed: `spawn` gave this parent a pid at all.
    expect(typeof child.pid).toBe('number')

    // The reading. Equality, because "a pid is present" is satisfied by any constant and
    // the claim is about *which* process is speaking.
    expect(handshake.pid).toBe(child.pid)

    // The two keys every pre-existing parent of this binary parses, checked here so the
    // "one added key is additive" argument is a reading rather than a sentence.
    expect(typeof handshake.peerId).toBe('string')
    expect(handshake.peerId.length).toBeGreaterThan(0)
    expect(handshake.multiaddrs.some((ma) => ma.includes('/tcp/'))).toBe(true)

    // BENCH-07 criterion 3 — the configuration in force, read off the started node rather
    // than restated from the flags this process was given. **No value is predicted**: see
    // the module comment. What is asserted is what the shared derivation implies.
    expect(Number.isInteger(handshake.inboundConnectionThreshold)).toBe(true)
    expect(handshake.inboundConnectionThreshold).toBeGreaterThan(0)
    expect(Number.isInteger(handshake.maxIncomingPendingConnections)).toBe(true)
    expect(handshake.maxIncomingPendingConnections).toBeGreaterThan(0)
    // Both fall out of one `max(libp2p's default, reservation limit)` on this configuration,
    // so an implementation that announced one of them from somewhere else shows up here.
    expect(handshake.inboundConnectionThreshold).toBe(handshake.maxIncomingPendingConnections)
    // Printed so the summary can record the observed pair — which is what converts the
    // figure from unverified into measured, without asserting it anywhere.
    process.stdout.write(
      `OBSERVED default agent limits: inboundConnectionThreshold=${String(handshake.inboundConnectionThreshold)}` +
        ` maxIncomingPendingConnections=${String(handshake.maxIncomingPendingConnections)}\n`,
    )

    // BENCH-06 — the same argument as `pid`, applied to the host. A driver that filled a
    // machine record in on a child's behalf would publish its own host under the child's
    // name, and the SAME-MACHINE label derived from those records would then be true
    // whatever the run had done — which is exactly what it was until 2026-08-14.
    //
    // `hostId` is asserted at a value because on this rig it *is* one: the child was
    // spawned by this process on this machine, so a child reading its own host must agree
    // with this one. That is the strongest reading available on a single host, and it is
    // the reading a `hostId: ''` or an omitted key both fail.
    expect(handshake.machine.hostId).toBe(hostname())
    // The remaining five are asserted as measurements rather than at values, on the same
    // rule the two inbound limits above follow: predicting a core count or a RAM figure
    // would be a test of this host, and a later machine would fail it for a reason about
    // nothing. `os` and `runtime` are the two that *can* be compared, so they are.
    expect(handshake.machine.cpuModel.length).toBeGreaterThan(0)
    expect(Number.isInteger(handshake.machine.logicalCores)).toBe(true)
    expect(handshake.machine.logicalCores).toBeGreaterThan(0)
    expect(handshake.machine.totalMemoryBytes).toBeGreaterThan(0)
    expect(handshake.machine.os).toBe(process.platform)
    expect(handshake.machine.kernel.length).toBeGreaterThan(0)
    expect(handshake.machine.runtime).toBe(`node ${process.version}`)

    // An agent given no `--peer-addr` dials nobody and says so. `[]` is a statement,
    // exactly as `relays` beside it is.
    expect(handshake.peers).toEqual([])

    // And it leaves when asked, so this file resides nothing beyond its own run. Read off
    // the process rather than off the signal that was sent: `kill` states an intention.
    await stopAgent(child)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }, 30_000)
})

describe('BENCH-07 — an agent can be given the inbound limit a published exclusion blames', () => {
  it('announces the threshold it was told to run at, and moves nothing else', async () => {
    const derived = await spawnAgent(join(workdir, 'derived'))
    const pinned = await spawnAgent(join(workdir, 'pinned'), ['--inbound-threshold', '5'])

    // Asserted at a value, and legitimately: 5 is what the caller stated. The default
    // agent's figure is derived, which is why the case above asserts a relationship instead.
    expect(pinned.handshake.inboundConnectionThreshold).toBe(5)

    // The pin is a pin and not a switch: the other limit keeps the value the derivation
    // gives it, and it is the same value the unflagged agent announced.
    expect(pinned.handshake.maxIncomingPendingConnections).toBe(
      derived.handshake.maxIncomingPendingConnections,
    )
    expect(pinned.handshake.pid).toBe(pinned.child.pid)
    expect(pinned.handshake.multiaddrs.some((ma) => ma.includes('/tcp/'))).toBe(true)
    expect(pinned.handshake.peers).toEqual([])

    // Anti-vacuity: if the flag did nothing, the two agents would announce the same
    // threshold — so the pin has to be observably different from the derived figure. This
    // is the one place the derived value is used, and it is used as a comparison rather
    // than as a prediction.
    expect(derived.handshake.inboundConnectionThreshold).not.toBe(5)
  }, 40_000)
})

/**
 * The dial leg the criterion-3 factorial rests on — and it is **pre-existing behaviour**.
 *
 * Plan 23-04 specified a new `--dial` flag for this and predicted these two cases would be
 * red before it landed. They are not: `--peer-addr` already dials after `FabricNode.start`
 * resolves and strictly before the handshake line is written, already reports the peer ids
 * it reached off the `Connection` rather than off the configured string, and already exits
 * non-zero with the message on stderr and no handshake when a dial fails. Nothing was added
 * to the binary for either reading.
 *
 * They are kept, and they are worth their two processes, because the `workers-to-submitter`
 * arm of `processFabric` now passes `--peer-addr` on every spawn and **nothing anywhere
 * asserted that path**. What they measure is that the arm's mechanism works; what they do
 * not measure is anything this plan wrote.
 */
describe('BENCH-07 — an agent can be told which node to dial, and a failed dial is visible at spawn', () => {
  it('reaches the address it was given and names the peer it reached, before announcing', async () => {
    target = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: join(workdir, 'target'),
      listen: ['/ip4/127.0.0.1/tcp/0'],
      rpcTimeoutMs: 30_000,
      // Empty, and stated rather than defaulted: this node is a dial target and nothing is
      // ever dispatched to it, so it vouches for no build authority at all.
      trustAnchors: [],
    })
    const address = target.multiaddrs.find((ma) => ma.includes('/tcp/'))
    expect(address).toBeDefined()

    const { handshake } = await spawnAgent(join(workdir, 'dialer'), ['--peer-addr', address ?? ''])

    // The peer id is read off the `Connection` the agent established, so this is the peer
    // actually reached rather than the one the address claimed.
    expect(handshake.peers).toContain(target.peerId)
    // The ordering claim: the line is written after the dials, so a parent holding the line
    // is holding a completed dial rather than an intention. A dial moved after the write
    // would leave this array empty.
    expect(handshake.peers.length).toBe(1)
  }, 60_000)

  it('exits without announcing when the dial fails, so the parent gets the error instead of the budget', async () => {
    // Port 1 needs privilege to bind, so nothing in this repository is listening there and
    // the peer id is syntactically real. The dial is refused rather than timing out, which
    // is what makes this case cheap.
    const unreachable = '/ip4/127.0.0.1/tcp/1/p2p/12D3KooWCJrxedHTCt5RNFSDkvMURi6BqMQmX7S2eTTigp32rM4m'

    // The whole reading: the spawn REJECTS. This is the shape the workers-dial-in attempts
    // of the criterion-3 factorial are built on — the failure a published exclusion
    // describes happens during the noise handshake, so it has to be observable at spawn
    // time rather than as a wait that ends at the 30 s budget with nothing to say.
    await expect(
      spawnAgent(join(workdir, 'unreachable'), ['--peer-addr', unreachable]),
    ).rejects.toThrow(/exited early/)
  }, 60_000)
})
