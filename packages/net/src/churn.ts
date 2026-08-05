/**
 * Dispatching a shard over RPC, with the failure kind preserved — CHURN-01, NET-09.
 *
 * A scheduler that recovers from churn wants to know *whose* fault a failure was: a node
 * that is gone should be retried elsewhere until the pool runs out, while a task that
 * fails on reachable nodes should be given up on quickly. That distinction exists on the
 * wire and is deliberately **not** available through `RemoteExecutor`, which flattens
 * everything into `{ ok: false, reason }` because `executeVerified` wants exactly that —
 * an unreachable replica and a trapping module are both just "this node did not agree".
 *
 * ## THIS MODULE HAS NO PRODUCTION CALLER, and that is a recorded debt
 *
 * Its only consumer was `runResilient`, which Plan 20-12 deleted: WIRE-04 requires exactly
 * one job entry point, and a second exported job implementation is that requirement's own
 * failure mode. `submitJob` is that entry point and it **cannot** use this adapter — it
 * dispatches through `Executor`, whose `ExecutionOutcome` has no `kind`, and 20-CONTEXT.md
 * ruled against both widening that port and parsing `reason` strings for policy. It
 * approximates the distinction by counting *distinct nodes that failed* instead, bounded
 * by `DEFAULT_MAX_GENERATIONS`.
 *
 * **So why is this still here?** Because what it holds is not a convenience, it is the only
 * implementation of NET-09's classification, and NET-09 is a met requirement. `'sender'` —
 * *this node did not send, by its own decision* — exists nowhere else in the tree, and the
 * six cases in `churn.test.ts` that read it are the only readings of it. Deleting the
 * adapter would delete a met requirement's evidence, which is how a phase loses a guard and
 * files it as cleanup. `mutation-ledger.ts`'s `M5` plants the `send-refused` branch below
 * and names `churn.test.ts` as its catcher, so the pair is load-bearing in the guard layer
 * too.
 *
 * **The debt, named with its owner.** Phase 22's reachability guard fails on an export with
 * no traced call path, and this is one. The two honest ways out are: a `kind` on
 * `ExecutionOutcome`, which `20-CONTEXT.md` lists under *Deferred Ideas* and which would
 * give `submitJob` the sharp distinction and this module a caller; or deleting it and
 * moving NET-09's classification to wherever `RpcFailure{send-refused}` is next read. Both
 * are decisions rather than cleanup, and neither is Phase 20's.
 *
 * The mapping is the whole content of the module:
 *
 * | What happened | Kind | Why |
 * |---|---|---|
 * | the RPC threw — timeout, a failed send, a failed *dial*, endpoint closed | `node` | the peer never answered |
 * | the RPC threw `RpcFailure{send-refused}` | `sender` | this node's own send bound refused; the peer was never asked |
 * | the reply did not parse | `node` | a peer talking nonsense is a peer to stop using |
 * | the reply was `error` | `node` | reachable, but refusing to serve this |
 * | `exec` came back `ok: false` | `task` | a reachable node ran it, and it failed |
 * | `exec` came back `ok: true` | — | store the output, return its CID |
 *
 * The `error` row is the one worth arguing about. A node answering "malformed request"
 * is alive, so calling it a node failure looks wrong — but the consequence of the two
 * kinds is *which retry policy applies*, and a node that will not serve this request is
 * one to route around, not evidence that the task is broken. Counting it as a task
 * failure would let one misconfigured peer condemn a perfectly good shard.
 *
 * The `sender` row (NET-09) is discriminated on the typed detail and on nothing else.
 * `rpc.ts` produces `send-refused` only when the caught cause is a `SendRefused` — the
 * marker a `Transport` raises to say *this node did not send, by its own decision*.
 * Every other rejection stays `send-failed`, which keeps its existing `'node'`
 * classification, and that includes the case most likely to be got wrong: a **failed
 * dial to an unreachable peer** arrives as `send-failed`, because `rpc.ts`'s catch is
 * bare and `Libp2pTransport.send` awaits `dialProtocol`. Classifying that as `'sender'`
 * would record a dead peer as a failure of *this* node.
 *
 * One case will otherwise surprise somebody: an `EgressRefusal` raised on this node's
 * own outbound request also arrives as `send-failed`, and therefore still classifies
 * `'node'`. That is unchanged, and it is stated here deliberately rather than left to
 * be inferred. If a later phase decides an egress refusal deserves `'sender'`, it makes
 * `EgressRefusal` carry the `SendRefused` marker; it does not widen this branch back
 * onto `send-failed`.
 *
 * Pure module.
 */

import { canonicalCid } from '@o2/core'
import type { Blockstore, OwnerId, Task } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import { RpcFailure } from './rpc.ts'
import type { RpcEndpoint } from './rpc.ts'

/**
 * One shard to run, carrying the sovereignty label that constrains where it may go.
 *
 * Moved here from `core/src/coordinator.ts` by Plan 20-12, unchanged. It described that
 * module's input; it now describes this adapter's, which is the only thing left that
 * reads it. `submitJob`'s own unit of work is `ShardSpec` — a *value* plus a label, not a
 * pre-assigned id — and the two are deliberately not merged: a `ShardWork` names work
 * somebody else has already partitioned.
 */
export interface ShardWork {
  readonly shardId: string
  /** The owner whose data this shard reads. Absent for public work. */
  readonly ownerId?: OwnerId
  readonly label: 'public' | 'sovereign'
}

/**
 * What one dispatch produced.
 *
 * Moved here from `core/src/coordinator.ts` by Plan 20-12. The failure kinds are the
 * distinction this module exists to preserve, and collapsing them into a single `null` —
 * which an earlier version did — makes churn recovery unable to tell a dead peer from a
 * broken task. They warrant different policies:
 *
 * - **`node`** — unreachable, refused, connection died. *Whose* fault is the node's,
 *   so the same task on a different node is expected to succeed. Retry freely; the
 *   only bound is running out of untried nodes.
 * - **`task`** — a reachable node ran the task and it failed: the module trapped, an
 *   input was missing, the output would not encode. Retrying this across the whole
 *   fabric burns every node in turn on work that cannot succeed, so it is capped low.
 * - **`sender`** — *this* node did not send, by its own decision: its per-peer send
 *   bound refused. Not the receiver's fault, so blaming it would route a healthy
 *   peer out of the pool; not the task's fault, so counting it against a task-failure
 *   budget would condemn a good shard. Retried like `node`, because a different peer
 *   means a different gate — but *named* differently, and therefore assertable. That
 *   naming is the whole point: a recorded failure attaches the *attempted* `nodeId`,
 *   so with only two kinds the record says the receiver failed no matter what the
 *   reason string says.
 *
 * A rejected promise counts as `node`, because an exception escaping a transport is
 * what an unreachable peer looks like from here.
 */
export type DispatchOutcome =
  | { readonly ok: true; readonly resultCid: string }
  | {
      readonly ok: false
      readonly kind: 'node' | 'task' | 'sender'
      readonly reason: string
    }

/**
 * Run one shard on one node.
 *
 * Moved here from `core/src/coordinator.ts` by Plan 20-12, **minus its third parameter**.
 * It used to take the `Lease` the coordinator had granted; `remoteDispatch` never read it,
 * and with the coordinator gone nothing supplies one. A parameter no caller passes and no
 * implementation reads is a claim about a contract that no longer exists.
 */
export interface ShardDispatch {
  (shard: ShardWork, nodeId: string): Promise<DispatchOutcome>
}

export interface RemoteDispatchOptions {
  readonly rpc: RpcEndpoint
  /** Where an accepted result is stored, so it is retrievable by CID like any block. */
  readonly blockstore: Blockstore
  /** Turns a unit of work into the content-addressed task that runs it. */
  readonly taskFor: (shard: ShardWork) => Task
}

/** A `ShardDispatch` that runs the shard on a remote peer and keeps the failure kind. */
export function remoteDispatch(options: RemoteDispatchOptions): ShardDispatch {
  return async (shard: ShardWork, nodeId: string): Promise<DispatchOutcome> => {
    const task = options.taskFor(shard)

    let body
    try {
      body = await options.rpc.request(nodeId, encodeRequest({ kind: 'exec', task }))
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      if (cause instanceof RpcFailure && cause.detail.kind === 'send-refused') {
        // This node's own send bound refused. The peer was never asked, so it did
        // not fail — and a scheduler records the *attempted* nodeId against every
        // failure, which is precisely why this needs a kind of its own and not a
        // better reason string. (`submitJob` records it on `ShardResult.attempted`;
        // the deleted `runResilient` recorded it on `ShardOutcome.failures`. Either
        // way the id names the receiver, so only the kind can say it was the sender.)
        return {
          ok: false,
          kind: 'sender',
          reason: `dispatch to ${nodeId} refused by ${cause.detail.by}: ${detail}`,
        }
      }
      return {
        ok: false,
        kind: 'node',
        reason: `dispatch to ${nodeId} failed: ${detail}`,
      }
    }

    const response = parseResponse(body)
    if (response === null) {
      return { ok: false, kind: 'node', reason: `malformed response from ${nodeId}` }
    }
    if (response.kind === 'error') {
      return { ok: false, kind: 'node', reason: `remote error from ${nodeId}: ${response.reason}` }
    }
    if (response.kind !== 'exec') {
      return {
        ok: false,
        kind: 'node',
        reason: `unexpected ${response.kind} response to exec request from ${nodeId}`,
      }
    }
    if (!response.outcome.ok) {
      return { ok: false, kind: 'task', reason: response.outcome.reason }
    }

    // Store the result so it is retrievable by CID like any other block — and so the
    // checkpoint can name it rather than carry it.
    const encoded = await canonicalCid(response.outcome.output)
    if (!encoded.ok) {
      // The node produced something that will not canonicalise. That is a property of
      // the output, not of the node, so re-running it elsewhere would fail the same
      // way — a task failure.
      return {
        ok: false,
        kind: 'task',
        reason: `result from ${nodeId} is not encodable: ${JSON.stringify(encoded.error)}`,
      }
    }
    await options.blockstore.put(encoded.bytes)
    return { ok: true, resultCid: encoded.cid.toString() }
  }
}
