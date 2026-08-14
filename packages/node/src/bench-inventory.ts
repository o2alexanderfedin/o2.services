/**
 * The machine inventory a published benchmark run reports — BENCH-06.
 *
 * ## Why this is a module rather than a function in `bin/bench.ts`
 *
 * That file runs `await main()` on import, so nothing declared inside it can be executed
 * by a test — every guard over it is a source-text read or a spawn with a temporary `cwd`.
 * `bench-fabric.node.test.ts` states the same rule about `processFabric` and gives the same
 * remedy: *a pure function lifted out*. This is that lift, and the reason it was worth
 * doing is the defect below.
 *
 * ## What was wrong, and it was wrong in the way this project most often gets things wrong
 *
 * `inventory()` built a **one-element array** from the driver's own `hostname()`, and no
 * code path could put a second host into it. So `hostCount` was `1` by construction, and
 * the published `SAME-MACHINE` label — the one BENCH-06 exists to require — was true
 * whatever the run had done. `report.ts` calls that label *derived, never declared*, and
 * it was neither: it was a constant with a derivation's shape. Concretely, replacing
 * `machineLabel(report.inventory)` with the literal string it always produced would have
 * left every published byte identical and no spec red. A claim no plant can falsify is not
 * a claim, and the requirement is not met by a value that happens to be right.
 *
 * ## What it is now
 *
 * Every spawned agent announces the host it is running on, on the handshake line it
 * already writes, and the driver merges those announcements with its own reading. So
 * `hostCount` counts hosts that **said so**, one per announcing process, and the same
 * driver run on two machines would publish two rows and lose the SAME-MACHINE label
 * without a line changing here.
 *
 * That does not make BENCH-06's distinct-machine half met — nothing in this repository
 * spawns an agent on a second host, so every run still observes one. The difference is
 * that the label is now a reading of what was observed rather than a statement about what
 * could be, and a run that did span two hosts would say so.
 *
 * ## Platform, deliberately
 *
 * `@o2/bench` is pure and must stay pure: it imports no `node:os` today and must not
 * start, which is why `Inventory` arrives there as data. Reading a host needs a platform,
 * so the reading lives here, in the node tier, and the merge below is separated from it so
 * the merge can be exercised without one.
 */

import { cpus, hostname, platform, release, totalmem } from 'node:os'
import type { Inventory, Machine, MachineRole } from '@o2/bench'
import type { AnnouncedMachine } from './bench-fabric.ts'

/**
 * This process's own host, as a `Machine`.
 *
 * `roles` is a parameter rather than a constant because the driver's position is the
 * driver's to state: it submits, it executes nothing on the process-per-node arm, and it
 * combines on both. An agent's roles are assigned by {@link machineFrom} for the opposite
 * reason — the agent cannot know what position a rig put it in.
 */
export function localMachine(roles: readonly MachineRole[]): Machine {
  const cores = cpus()
  return {
    hostId: hostname(),
    roles,
    cpuModel: cores[0]?.model ?? 'unknown',
    // `os.cpus()` reports logical CPUs. Physical count is not exposed portably, so it is
    // reported as unknown rather than guessed at half — a guess here would silently halve
    // the contention a reader infers.
    physicalCores: 0,
    logicalCores: cores.length,
    totalMemoryBytes: totalmem(),
    os: platform(),
    kernel: release(),
    runtime: `node ${process.version}`,
  }
}

/**
 * One agent's announcement, as a `Machine`.
 *
 * The two fields the announcement does not carry are filled here and not there.
 * `roles: ['worker']` is a fact about how the rig used the process, which the driver knows
 * and the process does not; `physicalCores: 0` is the same *unknown* the driver records
 * about itself, for the same portability reason. Everything else is copied unchanged —
 * this function measures nothing.
 */
export function machineFrom(announced: AnnouncedMachine): Machine {
  return {
    hostId: announced.hostId,
    roles: ['worker'],
    cpuModel: announced.cpuModel,
    physicalCores: 0,
    logicalCores: announced.logicalCores,
    totalMemoryBytes: announced.totalMemoryBytes,
    os: announced.os,
    kernel: announced.kernel,
    runtime: announced.runtime,
  }
}

/**
 * Fold a candidate list into an `Inventory`, one row per distinct `hostId`.
 *
 * **Pure, and separate from {@link inventory} so the refusal below can be watched firing.**
 * A guard reachable only through a caller that always prepends its own host is a guard
 * nothing can test, and this file exists because of a value nothing could test.
 *
 * First writer wins on a repeated `hostId`. That is not arbitrary: {@link inventory}
 * passes the driver's own reading first, and the driver knows its `roles` while an agent's
 * are assigned. Two processes on one host are one machine — which is the whole point of
 * counting hosts rather than counting announcements.
 *
 * The empty list throws rather than returning `{ machines: [] }`. `machineLabel` would
 * otherwise be handed an inventory with nothing in it, and a label reading `0 host` states
 * that a run happened nowhere — which is not a disclosure but a broken one, and worse than
 * a failure because it renders.
 */
export function inventoryOf(nodeCount: number, candidates: readonly Machine[]): Inventory {
  if (candidates.length === 0) {
    throw new RangeError(
      'an inventory needs at least one machine: with none, the published label would ' +
        'report a run that happened on no host at all',
    )
  }
  const machines: Machine[] = []
  for (const candidate of candidates) {
    if (machines.some((seen) => seen.hostId === candidate.hostId)) continue
    machines.push(candidate)
  }
  return { machines, nodeCount }
}

/**
 * The inventory a run publishes: this host, plus every host an agent announced.
 *
 * `announced` is the driver's collected `AgentHandle.announcedMachine` values, each read
 * off a child's own handshake line. An empty array is a statement and not a gap — a run
 * with no spawned agents (`--quick`, or the memory-transport ladder alone) genuinely
 * observed one host, and says so.
 */
export function inventory(nodeCount: number, announced: readonly AnnouncedMachine[]): Inventory {
  return inventoryOf(nodeCount, [
    // `aggregator` has been declared in `MachineRole` and never true since Phase 8. It
    // became accurate when the same processes started running combines as well as `exec`.
    localMachine(['worker', 'requestor', 'aggregator']),
    ...announced.map(machineFrom),
  ])
}
