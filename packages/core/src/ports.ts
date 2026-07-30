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
import type { OwnerId, Sovereignty } from './sovereignty.ts'

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
  /**
   * Sovereignty label and owner, carried to the serving node so a refusal can be
   * made there (DATA-09) rather than trusted to whoever dispatched the task.
   *
   * Deliberately optional at this interface level, not because the label is
   * optional in principle — the ~25 call sites across the repo that build a raw
   * `Task` literal for executor/protocol/verification tests unrelated to
   * sovereignty must keep compiling unchanged. `submitJob`'s own input contract
   * (`ShardSpec` in `job/submit.ts`) is where "every shard has a real label" is
   * actually enforced, as a compile-time discriminated union: every `Task`
   * `submitJob` itself constructs always carries one.
   */
  readonly label?: Sovereignty
  readonly ownerId?: OwnerId
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
  send(to: string, message: Uint8Array<ArrayBuffer>): Promise<void>
  onMessage(handler: (from: string, message: Uint8Array<ArrayBuffer>) => void): () => void
  readonly peers: readonly string[]
}

/**
 * The one thing a `Transport` raises to say **"this node did not send, by its own
 * decision"** — NET-09.
 *
 * Every other rejection of `Transport.send` means the send was *attempted* and
 * failed: an unreachable peer, a refused protocol, a dial timeout, a reset stream.
 * Those are conditions of the peer or the network. This one is not: it is this
 * node's own admission bound declining to open another stream, and nothing about
 * the destination is implied by it.
 *
 * The distinction has to be carried by a type rather than by a message, because
 * `rpc.ts` catches every `send` rejection in one bare `.catch` and flattens it to
 * `RpcError{kind:'send-failed'}`. A dead receiver arrives there by exactly the same
 * route as a gate refusal, so branching on `send-failed` would file a peer's death
 * under this node's fault — the misattribution NET-09's criterion 5 exists to
 * remove, pointed the other way.
 *
 * **Why it lives in `@o2/core` and not beside the gate that throws it.** `@o2/net`
 * and `@o2/libp2p` do not depend on each other — each depends on this package and
 * neither on the other (checked in their `package.json`s). `@o2/libp2p`'s
 * `Libp2pTransport` raises it and `@o2/net`'s `RpcEndpoint` reads it, so the port's
 * own package is the only place both can import from.
 *
 * The class is the one runtime declaration in this otherwise type-only file. It has
 * no imports and no behaviour beyond carrying `to` and `by`, so the "free of
 * anything but types" rule at the top is intact in the sense that matters: nothing
 * platform-specific enters here.
 */
export class SendRefused extends Error {
  /** The destination this node declined to send to. */
  readonly to: string
  /** The node that refused — its own peer id, not the destination's. */
  readonly by: string

  constructor(message: string, detail: { readonly to: string; readonly by: string }) {
    super(message)
    this.name = 'SendRefused'
    this.to = detail.to
    this.by = detail.by
  }
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
