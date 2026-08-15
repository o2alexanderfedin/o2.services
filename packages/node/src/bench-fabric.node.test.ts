import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import { ed25519 } from '@noble/curves/ed25519.js'
import { hostCount, isSameMachine, machineLabel } from '@o2/bench'
import type { Machine } from '@o2/bench'
import { MemoryBlockstore, signName, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord } from '@o2/core'
import { submitJobWithEgress } from '@o2/net'
import { afterEach, describe, expect, it } from 'vitest'
// Test-only relative import — the same one `two-process.node.test.ts` takes, and for the
// same reason: it keeps this file free of a dependency the fixture choice would impose.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { processFabric } from './bench-fabric.ts'
import type { AnnouncedMachine, ProcessFabric } from './bench-fabric.ts'
import { inventory, inventoryOf, localMachine, machineFrom } from './bench-inventory.ts'

/**
 * BENCH-07 — a fabric of N real operating-system processes, driven by a real job.
 *
 * ## Why this file exists at all, rather than more source-text guards over `bin/bench.ts`
 *
 * That file runs `await main()` on import, so nothing in it can be executed by a test —
 * every guard over it is a source-text read, a spawn with a temporary `cwd`, or a pure
 * function lifted out. `processFabric` lives in a module precisely so the claim can be
 * *run*: two agent processes are spawned, a job crosses the boundary into them, and every
 * identity reading the benchmark driver's integrity check will take is asserted here
 * against processes that really exist.
 *
 * ## Every node here is the same node
 *
 * The submitting node is a `FabricNode` built by this process; each worker is a
 * `FabricNode` built by `bin/agent.ts`. Same class, same capability. What differs is
 * position — who holds the module first and who dials whom — and position is not a kind.
 *
 * ## The pid reading this file does NOT carry
 *
 * `announcedPid === pid` is asserted below, and on its own it is only as strong as the
 * construction behind it: a `ProcessFabric` that filled `announcedPid` from `child.pid`
 * would satisfy it by identity. That plant was applied and this file stayed green. What
 * carries the claim is `agent-handshake.node.test.ts`, which compares the pid a *spawned
 * binary printed* against the pid `spawn` returned. The assertion here reads that the
 * fabric propagated it, not that it was ever true.
 *
 * Node-only by necessity: the subject is a set of operating-system processes.
 */

/**
 * DET-03 is not this file's subject; the process boundary is. The record exists so the
 * subject can be reached at all — every worker is a spawned `bin/agent.ts`, which pins the
 * demo's anchor by default, so an unsigned job would have every dispatch refused and the
 * boundary would never be crossed.
 *
 * Seed 23, checked against every other `new Uint8Array(32).fill(...)` in `packages/` and
 * `tools/` on 2026-08-05.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(23)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/** Read the 4-byte little-endian partition index the fixture emits. */
function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The record the caller holds, signed over the CID a store computes for these bytes.
 *
 * Computed here rather than inside the fabric because `processFabric` takes the bytes and
 * the record as parameters: the fixture choice belongs to the caller, and the caller is
 * the one holding the signing key.
 */
async function fixtureRecord(): Promise<NameRecord> {
  const cid = await new MemoryBlockstore().put(MODULE_WRITES_PARTITION)
  return signName(publisher.priv, {
    name: 'bench-fabric-fixture',
    cid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

let fabric: ProcessFabric | undefined

/** A pid that answers is a process that is running. `EPERM` is an answer of yes. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Inner 10 s, outer 30 s — `stopAgent` gives a wedged process 10 s before SIGKILL, and
 * vitest's default `hookTimeout` is also 10 s, so with no budget here the framework's
 * clock fires first and the SIGKILL fallback can never run. The same ordering
 * `two-process.node.test.ts` records for its own teardown.
 */
afterEach(async () => {
  if (fabric !== undefined) await fabric.close().catch(() => {})
  fabric = undefined
}, 30_000)

describe('BENCH-07 — processFabric puts N nodes in N operating-system processes', () => {
  it('runs a real job across two spawned agents and reports every identity the harness check needs', async () => {
    const record = await fixtureRecord()
    const built = await processFabric(2, MODULE_WRITES_PARTITION, record, {
      trustAnchors: [publisher.pub],
    })
    fabric = built

    // ── N real processes, N distinct identities ────────────────────────────────────
    expect(built.agents.length).toBe(2)
    expect(new Set(built.agents.map((a) => a.pid)).size).toBe(2)
    expect(built.agents.every((a) => a.announcedPid === a.pid && a.pid !== process.pid)).toBe(true)
    // The submitting node is in *this* process, so it is the one pid on the rig that is
    // allowed to be the driver's own — and it is not an agent.
    expect(built.agents.map((a) => a.peerId)).not.toContain(built.submitterPeerId)

    // ── BENCH-06 — each agent's host, propagated off its own handshake ─────────────
    //
    // The same shape as `announcedPid` above, and the same caveat: a rig that filled
    // `announcedMachine` from this process's `hostname()` would satisfy the equality below
    // by identity. `agent-handshake.node.test.ts` is what carries that claim, comparing
    // what a *spawned binary printed* against this process's reading. What is asserted
    // here is that the fabric propagated it — which is the seam `bin/bench.ts` reads, and
    // the seam that did not exist until 2026-08-14.
    for (const agent of built.agents) {
      expect(agent.announcedMachine.hostId).toBe(hostname())
      expect(agent.announcedMachine.logicalCores).toBeGreaterThan(0)
      expect(agent.announcedMachine.runtime).toBe(`node ${process.version}`)
    }

    // Both agents ran here, so this rig really is same-machine and is labelled so — from
    // three readings that agreed, not from one that could not have disagreed.
    const observed = inventory(3, built.agents.map((a) => a.announcedMachine))
    expect(hostCount(observed)).toBe(1)
    expect(machineLabel(observed)).toBe(
      'SAME-MACHINE: 3 nodes on 1 host — a node count, not a machine count',
    )

    // **The anti-vacuity reading.** The same real announcements with one `hostId` changed
    // and nothing else moved — same call, same driver, same process. If the label were
    // still coming from this process's own `hostname()`, as it did until 2026-08-14, it
    // would be unchanged. It is not.
    const elsewhere = inventory(3, [
      built.agents[0]!.announcedMachine,
      { ...built.agents[1]!.announcedMachine, hostId: `${hostname()}-elsewhere` },
    ])
    expect(hostCount(elsewhere)).toBe(2)
    expect(isSameMachine(elsewhere)).toBe(false)
    expect(machineLabel(elsewhere)).toBe('3 nodes across 2 hosts')

    // ── the executors dispatch to the children, never to the submitter ─────────────
    expect(built.executors.map((e) => e.nodeId).sort()).toEqual(built.agents.map((a) => a.peerId).sort())
    expect(built.executors.map((e) => e.nodeId)).not.toContain(built.submitterPeerId)

    // ── every executor has a descriptor placement can rank ─────────────────────────
    expect(built.nodes.map((n) => n.nodeId).sort()).toEqual(built.executors.map((e) => e.nodeId).sort())

    // ── the ten-member seam is populated, not merely typed ─────────────────────────
    expect(built.moduleCid.toString()).toBe(record.cid.toString())
    expect(built.moduleRecord).toBe(record)
    expect(built.combineIssuers).toBe('checks-no-combine-signatures')
    // Absent, not `undefined`: `submitJob` branches on `spec.admit === undefined`, and an
    // explicit key would still be absent-valued while being a different type.
    expect(Object.hasOwn(built, 'admit')).toBe(false)

    // ── a real job, at redundancy 1, across the boundary ───────────────────────────
    //
    // Only the submitting process holds the module. Each worker is a fresh process with an
    // empty directory, so every byte it needs — the module included — arrives over the
    // wire or the shard does not complete.
    const result = await submitJobWithEgress(
      {
        moduleCid: built.moduleCid,
        moduleRecord: built.moduleRecord,
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({
          value,
          label: 'public' as const,
        })),
        executors: built.executors,
        nodes: built.nodes,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      built.blockstore,
      [built.guard],
      // CHURN-03 — this file asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    expect(result.job.shards.every((s) => s.verification.status === 'agreed')).toBe(true)
    expect(
      result.job.shards.map((s) => (s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1)),
    ).toEqual([0, 1, 2, 3])

    // Every agreeing replica ran in a child process, so nothing was quietly executed here.
    for (const shard of result.job.shards) {
      if (shard.verification.status !== 'agreed') continue
      for (const entry of shard.verification.agreeing) {
        expect(built.agents.map((a) => a.peerId)).toContain(entry.nodeId)
      }
    }

    // ── the surfaced guard is the live one, not a field nobody wired ───────────────
    expect(result.manifests.length).toBeGreaterThan(0)
    expect(result.manifests[0]!.entries.length).toBeGreaterThan(0)

    // ── disposal leaves nothing resident ──────────────────────────────────────────
    //
    // Read off the process table rather than off `exitCode`. An exit code is a statement
    // made by a process that exited, and the claim is about a process that might not have
    // — `orphan-leash.node.test.ts` states the same rule about the same binary.
    const pids = built.agents.map((a) => a.pid)
    const dirs = built.agents.map((a) => a.dir)
    await built.close()
    fabric = undefined
    expect(pids.filter((pid) => isAlive(pid))).toEqual([])
    expect(dirs.filter((dir) => existsSync(dir))).toEqual([])
  }, 120_000)
})

/**
 * The inverse dial direction and the pinned cap — BENCH-07 criterion 3's two levers.
 *
 * **Added outside Plan 23-04's declared file list, deliberately, and the cost of not adding
 * it is the reason.** Attempts F and G of that plan's factorial are the only cells that put
 * N processes on one host dialling one node at once, which is the population the published
 * exclusion blames. They run inside `bin/bench.ts`, whose `main()` executes on import, so
 * nothing in any suite can reach them — an arm that had never been exercised would be
 * discovered broken during a twenty-minute run, and a broken arm and a rung that failed for
 * the reason under investigation are indistinguishable from the outside.
 *
 * At two nodes it costs one rig. It says nothing about sixteen.
 */
describe('BENCH-07 — the rig can be built with the workers dialling in, and with the cap pinned', () => {
  it('has every agent reach the submitter before it announces, at the threshold it was given', async () => {
    const record = await fixtureRecord()
    const built = await processFabric(2, MODULE_WRITES_PARTITION, record, {
      trustAnchors: [publisher.pub],
      dial: 'workers-to-submitter',
      inboundThreshold: 5,
      submitterInboundThreshold: 5,
    })
    fabric = built

    // The direction, read off what each agent said it reached rather than off the option
    // that asked for it. `--peer-addr` dials before the handshake is written, so a rig that
    // exists at all is a rig whose dials completed.
    for (const agent of built.agents) {
      expect(agent.peers).toContain(built.submitterPeerId)
    }

    // The cap, read off each agent's own started node. This is the value the published
    // exclusion blames, made settable — and 5 is asserted because 5 is what the caller
    // stated. No assertion anywhere names the derived figure.
    expect(built.agents.map((a) => a.inboundConnectionThreshold)).toEqual([5, 5])
    // The other limit stays derived, which is what makes this one lever rather than two.
    expect(built.agents.every((a) => a.maxIncomingPendingConnections !== 5)).toBe(true)

    // And the job still crosses the boundary, so the direction is a change to who accepts
    // rather than to whether a dispatch arrives.
    const result = await submitJobWithEgress(
      {
        moduleCid: built.moduleCid,
        moduleRecord: built.moduleRecord,
        shards: [{ a: 0 }, { a: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors: built.executors,
        nodes: built.nodes,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      built.blockstore,
      [built.guard],
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    for (const shard of result.job.shards) {
      if (shard.verification.status !== 'agreed') continue
      for (const entry of shard.verification.agreeing) {
        expect(built.agents.map((a) => a.peerId)).toContain(entry.nodeId)
      }
    }
  }, 120_000)
})

/**
 * BENCH-06 — the fold that turns announcements into a published host count.
 *
 * ## The defect these cases exist to make impossible
 *
 * `inventory()` lived in `bin/bench.ts` and built a **one-element array** from the driver's
 * own `hostname()`. No code path could put a second host into it, so `hostCount` was `1` by
 * construction and every run was labelled SAME-MACHINE whatever it had done. `report.ts`
 * calls that label *derived, never declared* — and it was neither. Replacing
 * `machineLabel(report.inventory)` with the literal string it always produced would have
 * left every published byte identical and no spec red.
 *
 * Two things kept it unfalsifiable and both had to move. The array was one. The other is
 * that `bin/bench.ts` runs `await main()` on import, so a function declared in it can never
 * be executed by a test — which is the same reason this whole file exists, stated in its
 * header as *a pure function lifted out*. `bench-inventory.ts` is that lift.
 *
 * ## Why these are synthetic and the case above is not
 *
 * One host is all this repository can spawn on, so the multi-host arm has no other way to
 * be exercised — and an arm that is never exercised is an arm that is broken when it is
 * first needed. The rig case above supplies what synthesis cannot: that the values being
 * folded came off child processes' own handshake lines.
 */

/** A synthetic announcement. Only `hostId` varies in the cases that count hosts. */
const announcement = (hostId: string): AnnouncedMachine => ({
  hostId,
  cpuModel: 'Test CPU',
  logicalCores: 16,
  totalMemoryBytes: 32 * 1024 ** 3,
  os: 'darwin',
  kernel: '25.5.0',
  runtime: 'node v24.0.0',
})

const asMachine = (hostId: string): Machine => machineFrom(announcement(hostId))

describe('BENCH-06 — the inventory counts hosts that said so', () => {
  it('makes two announcing hosts two rows, and drops the same-machine label', () => {
    const built = inventoryOf(4, [asMachine('alpha'), asMachine('beta')])

    expect(built.machines.map((m) => m.hostId)).toEqual(['alpha', 'beta'])
    expect(hostCount(built)).toBe(2)
    expect(isSameMachine(built)).toBe(false)
    expect(machineLabel(built)).toBe('4 nodes across 2 hosts')
  })

  it('folds repeated announcements from one host into one machine', () => {
    // Sixteen processes on one host are one machine. This is what every published run has
    // actually been, and the label it produces is the one the report carries.
    const built = inventoryOf(
      16,
      Array.from({ length: 16 }, () => asMachine('one-laptop')),
    )

    expect(built.machines.length).toBe(1)
    expect(hostCount(built)).toBe(1)
    expect(machineLabel(built)).toBe(
      'SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count',
    )
  })

  /**
   * First writer wins, and the reading is on `roles` rather than on the count.
   *
   * The driver knows its own position — it submits, and it combines — while an agent's
   * `roles` are assigned by `machineFrom`, because a spawned process cannot know what a rig
   * used it for. So when both land on one `hostId`, the row that survives must be the
   * driver's. A fold that kept the last writer would publish this host as a bare worker.
   */
  it('keeps the driver’s own row when an agent announces the driver’s host', () => {
    const driver = localMachine(['worker', 'requestor', 'aggregator'])
    const built = inventoryOf(2, [driver, asMachine(driver.hostId)])

    expect(built.machines.length).toBe(1)
    expect(built.machines[0]?.roles).toEqual(['worker', 'requestor', 'aggregator'])
  })

  it('refuses an inventory with no machines rather than publishing `0 host`', () => {
    // The condition `machineLabel` refuses at the package boundary, refused here at
    // construction so it cannot reach the renderer at all.
    expect(() => inventoryOf(16, [])).toThrow(RangeError)
    expect(() => inventoryOf(16, [])).toThrow(/at least one machine/)
  })

  it('publishes this host alone when nothing was spawned, and says so as a count', () => {
    // `--quick`, and the memory-transport ladder generally: no child announced anything, so
    // one host was observed and one host is reported. An empty `announced` is a statement.
    const built = inventory(4, [])
    expect(built.machines.map((m) => m.hostId)).toEqual([hostname()])
    expect(hostCount(built)).toBe(1)
  })

  it('copies an announcement’s six measurements and invents nothing', () => {
    // `machineFrom` measures nothing. The two fields it fills are the two an announcing
    // process cannot know: its position in the rig, and a physical core count no platform
    // exposes portably.
    const source = announcement('elsewhere')
    const built = machineFrom(source)

    expect(built.hostId).toBe(source.hostId)
    expect(built.cpuModel).toBe(source.cpuModel)
    expect(built.logicalCores).toBe(source.logicalCores)
    expect(built.totalMemoryBytes).toBe(source.totalMemoryBytes)
    expect(built.os).toBe(source.os)
    expect(built.kernel).toBe(source.kernel)
    expect(built.runtime).toBe(source.runtime)
    expect(built.roles).toEqual(['worker'])
    expect(built.physicalCores).toBe(0)
  })
})
