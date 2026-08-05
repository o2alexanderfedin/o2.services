/**
 * Dispatching a shard over RPC, with the failure kind preserved — CHURN-01.
 *
 * `runResilient` needs to know *whose* fault a failure was: a node that is gone should
 * be retried elsewhere until the pool runs out, while a task that fails on reachable
 * nodes should be given up on quickly. That distinction exists on the wire and is
 * deliberately **not** available through `RemoteExecutor`, which flattens everything
 * into `{ ok: false, reason }` because `executeVerified` wants exactly that — an
 * unreachable replica and a trapping module are both just "this node did not agree".
 *
 * So this adapter reads the response itself rather than changing that port. The
 * mapping is the whole content of the module:
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
import type { Blockstore, DispatchOutcome, ShardDispatch, ShardWork, Task } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import { RpcFailure } from './rpc.ts'
import type { RpcEndpoint } from './rpc.ts'

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
        // not fail — and `runResilient` records the *attempted* nodeId against
        // every failure, which is precisely why this needs a kind of its own and
        // not a better reason string.
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
