import { existsSync } from 'node:fs'
import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryBlockstore, signName, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord } from '@o2/core'
import { submitJobWithEgress } from '@o2/net'
import { afterEach, describe, expect, it } from 'vitest'
// Test-only relative import — the same one `two-process.node.test.ts` takes, and for the
// same reason: it keeps this file free of a dependency the fixture choice would impose.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { processFabric } from './bench-fabric.ts'
import type { ProcessFabric } from './bench-fabric.ts'

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
