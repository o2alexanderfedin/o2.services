/**
 * Ports — the kernel's entire contact surface with the outside world.
 *
 * The kernel is pure. Everything platform-specific (a filesystem, IndexedDB, a
 * socket, a Worker, a clock) enters through one of these interfaces. That is what
 * lets Phase 2 swap a real network transport in without the kernel changing, and
 * what lets the same test suite run under node, browser, and webworker.
 *
 * Keep this file free of imports from anything but types.
 */

import type { CID } from 'multiformats/cid'
import type { CanonicalValue } from './canonical/encode.ts'

/** Content-addressed block storage. */
export interface Blockstore {
  put(bytes: Uint8Array<ArrayBuffer>): Promise<CID>
  get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined>
  has(cid: CID): Promise<boolean>
  readonly size: number
}

/** One unit of work handed to an executor. */
export interface Task {
  /** CID of the admitted WASM module. */
  readonly moduleCid: CID
  /** CID of the canonical input block. */
  readonly inputCid: CID
  /** Zero-based shard index. */
  readonly partitionIndex: number
  /** Total shard count for the job. */
  readonly partitionCount: number
}

/** What an executor produces. Output is a declared value, never raw memory. */
export type ExecutionOutcome =
  | { ok: true; output: CanonicalValue; fuelUsed: number }
  | { ok: false; reason: string }

/**
 * Executes a task.
 *
 * Implementations must be side-effect free with respect to the task: the same
 * (module, input, partition) must produce the same output. `nodeId` identifies
 * which node ran it, and is deliberately NOT part of the compared digest.
 */
export interface Executor {
  readonly nodeId: string
  execute(task: Task): Promise<ExecutionOutcome>
}

/** Moves messages between nodes. The loopback implementation has no network. */
export interface Transport {
  readonly localId: string
  send(to: string, message: Uint8Array): Promise<void>
  onMessage(handler: (from: string, message: Uint8Array) => void): () => void
  readonly peers: readonly string[]
}

/**
 * Caps how much CPU a node will spend, expressed as a duty cycle.
 *
 * BOINC's `% CPU` is a duty cycle rather than a scheduler priority — 75% means
 * compute for 3 units then idle for 1 — chosen there for thermal and battery
 * reasons. It is the cheapest control that works identically in a browser tab
 * and in Node, so it is the port shape here too.
 */
export interface Governor {
  /** Fraction of wall time this node may compute, in (0, 1]. */
  readonly dutyCycle: number
  /** Await the next permitted compute slice. */
  yieldSlice(): Promise<void>
}
