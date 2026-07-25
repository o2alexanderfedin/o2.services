/**
 * `RemoteExecutor` — the adapter that makes another machine look like a local one.
 *
 * This is the whole reason the kernel is unchanged by the arrival of a network.
 * `submitJob` takes `Executor[]` and does not care where one runs; an executor
 * whose `execute` happens to cross a wire satisfies the same contract as one that
 * calls into V8 directly. The redundancy, commit-reveal, and verification logic is
 * untouched.
 *
 * `nodeId` is the *remote* peer's id, which matters for more than logging:
 * `executeVerified` groups results by node and names the dissenter on
 * disagreement, so the id has to identify the machine that actually ran the task.
 *
 * A network failure is returned as `{ ok: false, reason }`, never thrown. An
 * unreachable replica is a normal event in a fabric of volunteer nodes — it must
 * degrade to "this node failed", which verification already handles, rather than
 * rejecting the whole job.
 *
 * Pure module.
 */

import type { ExecutionOutcome, Executor, Task } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

export class RemoteExecutor implements Executor {
  readonly nodeId: string
  readonly #rpc: RpcEndpoint

  /** @param nodeId the remote peer's id — the machine that will run the task. */
  constructor(nodeId: string, rpc: RpcEndpoint) {
    this.nodeId = nodeId
    this.#rpc = rpc
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    let body
    try {
      body = await this.#rpc.request(this.nodeId, encodeRequest({ kind: 'exec', task }))
    } catch (cause) {
      return {
        ok: false,
        reason: `dispatch to ${this.nodeId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }

    const response = parseResponse(body)
    if (response === null) {
      return { ok: false, reason: `malformed response from ${this.nodeId}` }
    }
    if (response.kind === 'error') {
      return { ok: false, reason: `remote error from ${this.nodeId}: ${response.reason}` }
    }
    if (response.kind !== 'exec') {
      return { ok: false, reason: `unexpected ${response.kind} response to exec request` }
    }
    return response.outcome
  }
}
