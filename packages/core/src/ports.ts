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
import type { WorkerTaskRequest, WorkerTaskResponse } from './executor/task-run.ts'
// Type-only, so it adds no runtime edge to a file whose header rule is "types only";
// and `naming.ts` does not import this file, so there is no cycle to create either way.
import type { NameRecord } from './naming.ts'
// Type-only for `naming.ts`'s reason: no runtime edge, and `result-attestation.ts` does
// not import this file, so there is no cycle to create either way.
import type { AttestedResult } from './result-attestation.ts'
import type { OwnerId, Sovereignty } from './sovereignty.ts'

/** Content-addressed block storage. */
export interface Blockstore {
  put(bytes: Uint8Array<ArrayBuffer>): Promise<CID>
  get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined>
  /**
   * Does **this** store hold the block — answered without going to the network.
   *
   * The distinction from {@link Blockstore.get} is the whole point and is now written
   * down, because a caller depended on it before anything stated it. `get` may be
   * decorated to fall back to peers — `FetchingBlockstore` in `@o2/net` is exactly that —
   * while `has` is *"local presence only"* in that class's own words, so callers can make
   * cheap decisions without a version that dialled peers turning an availability check
   * into a round trip.
   *
   * **What went wrong when this was only implied.** `serveAgent`'s `block` branch answered
   * a peer with `blockstore.get`, and in production that blockstore fetches. So a node
   * asked for a block it did not hold went looking for one on behalf of the peer that
   * asked; two nodes pointed at each other handed one another the same pending promise and
   * neither could ever answer. The branch now gates on `has`, which makes this line the
   * contract that keeps it correct rather than an accident of which store was passed.
   *
   * An implementation that answered this by consulting the network would reintroduce that
   * defect at a distance, which is why the rule lives on the port and not in one caller.
   */
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
  /**
   * The signed `key → CID` mapping that vouches for `moduleCid` (DET-03, DATA-08).
   *
   * A CID proves the bytes are the bytes that were hashed; it does not say who meant
   * them to run. This is what says that, and it travels with the task so the refusal
   * can be made on the serving node rather than trusted to whoever dispatched it —
   * the same reason `label` travels, above.
   *
   * Deliberately optional at this interface level, and for exactly `label`'s reason:
   * the raw `Task` literals across the executor, protocol and verification tests,
   * whose subject is not provenance, must keep compiling unchanged.
   *
   * Optional here is not optional in effect, and enforcement is deliberately not in
   * this file. `executor/module-provenance.ts` refuses a `Task` that arrives without
   * a record, before any byte of the module is fetched; the two sites that compose
   * that guard into a serving node's executor are `packages/node/src/fabric-node.ts`
   * and `packages/browser/src/browser-node.ts`.
   */
  readonly moduleRecord?: NameRecord
}

/**
 * What an executor produces. Output is a declared value, never raw memory.
 *
 * ## `attestation` — what the *node* says about what it produced
 *
 * Distinct from the compared digest, and deliberately so. `output` is compared across
 * replicas to detect divergence (VER-05); an attestation is per-node by construction
 * and is never compared, because two honest replicas of one shard sign different bytes
 * and always will. The rule at `Executor` below — that `nodeId` is not part of the
 * compared digest — is about the compared value and is untouched by this field.
 *
 * **Required, with a named sentinel, never optional.** An omitted field read as
 * "attested" would make an unsigned result indistinguishable from a signed one at
 * exactly the point a receipt is computed, which is the one place the distinction is
 * the product. `.planning/PROJECT.md` records the general form of the rule: an optional
 * hook with a silent default is a hole.
 *
 * `'signed-by-nobody'` is a **truthful statement by an executor nobody enrolled**, not a
 * degraded mode and not an error. The kernel's own executors — `WasmExecutor`,
 * `WorkerExecutor`, `runTask` and `@o2/aot`'s `WasiExecutor` — take it by construction,
 * because a kernel that signed would need an identity, and keeping an identity out of
 * the kernel is what this file exists for. Signing is a wrapper composed at a node's
 * construction (`executor/attesting-executor.ts`), on the same terms as
 * `guardModuleProvenance`.
 *
 * The **failure arm carries nothing**: a failed execution attests nothing, because there
 * is no output and therefore no statement to sign.
 */
export type ExecutionOutcome =
  | { ok: true; output: CanonicalValue; fuelUsed: number; attestation: AttestedResult }
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

/**
 * A thread that runs tasks and can be killed mid-instruction.
 *
 * The port exists because the two tiers spell the same four operations differently
 * and nothing else about them differs: a DOM `Worker` has `addEventListener` and
 * `terminate()`, a `node:worker_threads` `Worker` has `.on()` and `.terminate()`.
 * With those behind one interface the executor that arms the wall-clock deadline is
 * written once and both tiers get the identical bound — which is the standing rule
 * that all nodes have equal functionality, applied to the one place where two
 * independently-maintained deadline constants would quietly reintroduce a node class.
 *
 * `kill()` is what makes the bound real. A guest `run()` is a synchronous call and
 * V8 has no fuel metering, so no timer on the thread executing it will ever fire.
 * Ending the thread is the only mechanism available, on either tier.
 */
export interface ComputeThread {
  post(request: WorkerTaskRequest): void
  onResponse(handler: (response: WorkerTaskResponse) => void): void
  onError(handler: (reason: string) => void): void
  kill(): void
}

/** Builds a {@link ComputeThread}. Injected, so the tier is the caller's choice. */
export type ComputeThreadFactory = () => ComputeThread

/**
 * Moves messages between nodes. The loopback implementation has no network.
 *
 * **`from` and `to` are the same namespace, spelled identically.** The `from` handed
 * to `onMessage` must be drawn from the namespace `send`'s `to` accepts, so that a
 * peer dialled as `to` reports as that exact string when it answers. `rpc.ts`
 * correlates a reply against the peer its request went to, and it does that by
 * comparing these two strings — an implementation that dialled by one spelling and
 * reported by another would turn every reply into a timeout.
 */
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
