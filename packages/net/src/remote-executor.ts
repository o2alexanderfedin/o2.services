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
 * AUTH-03: the *minting* side of this is still entry-point-unreachable, and that
 * is recorded here rather than left to be discovered. Every non-test
 * `new RemoteExecutor(` site in the repository dispatches public work —
 * `bin/bench.ts` and `bench/src/perf-workload.ts` label every shard `'public'`,
 * and the browser demo's colouring job has no owner — so `delegate` is called only
 * from tests and Phase 22's reachability guard will find it. Three options were
 * considered. Giving `bin/bench.ts` a sovereign leg would change what the benchmark
 * measures, which is exactly what this phase set out to protect so the scaling
 * curve stays comparable across the change. Giving the demo one is impossible
 * without an owner and a private key to root a chain at. So the third was taken:
 * the requestor half is accepted as entry-point-unreachable and named here, in
 * source, where Phase 22 will read it. The roadmap carries the same finding; if the
 * two ever disagree, this comment is the one a reader hits first and the roadmap is
 * the one an auditor greps.
 *
 * Pure module.
 */

import type { CanonicalValue, Delegation, ExecutionOutcome, Executor, Task } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

/**
 * Chooses the chain to dispatch a given task with.
 *
 * A function of the task rather than a fixed array, because one `RemoteExecutor`
 * serves every shard of a job and shards may name different owners. Returning `[]`
 * says "nothing to state for this task", which is what a public shard returns.
 */
export type CapabilitySupplier = (task: Task) => readonly Delegation[]

export class RemoteExecutor implements Executor {
  readonly nodeId: string
  readonly #rpc: RpcEndpoint
  readonly #capability: CapabilitySupplier | 'dispatches-unauthenticated'

  /**
   * @param nodeId the remote peer's id — the machine that will run the task.
   * @param rpc the endpoint the request goes out on.
   * @param capability what chain, if any, to dispatch with.
   *
   * The third parameter is **required, not optional**, and the reason is
   * `.planning/PROJECT.md`'s Key Decision *"An optional hook with a silent default
   * is a hole"*. An optional argument here would mean a `RemoteExecutor` built
   * without one dispatches unauthenticated and nothing fails — which is the precise
   * defect this milestone exists to remove, reproduced in the act of closing it.
   * `serveAgent`'s seven hooks already carry that compile-time proof
   * (`agent-contract.test.ts`); this makes the two sides symmetric.
   *
   * It is a **supplier rather than a fixed array** because one `RemoteExecutor`
   * serves every shard of a job, and shards may name different owners, so the chain
   * has to be selected per task. Same reasoning as `RpcBlockSource`'s `peers`
   * (`agent.ts:31-45`) and `AgentOptions.reservations` (`agent.ts:130`), which are
   * thunks so the answer is the live one rather than a snapshot taken at
   * construction.
   *
   * The chain rides on this **per-remote adapter rather than on `Task`** because
   * the audience a chain must end at is *this* remote node's key: a chain minted
   * for node A is refused at node B with `wrong-audience` (`capability.ts:203-205`).
   * A task is one description of work that may be dispatched to several nodes, so a
   * chain carried on it could only ever name one of them. Widening the `Executor`
   * port to carry a chain would push a network concern into the kernel and is the
   * wrong direction for the same reason.
   *
   * An **empty return and the sentinel produce the same bytes.** `agent.ts:402-408`
   * coalesces an absent `capability` and an empty one to the same value before any
   * `Authorizer` sees them, so the two are indistinguishable to an authorizer by
   * construction — which makes `[]` an honest answer, not a way around the
   * requirement. It also means today's public dispatch frames stay byte-identical
   * to pre-Phase-15 ones, which is what keeps `bin/bench.ts`'s scaling curve
   * comparable across this change.
   */
  constructor(
    nodeId: string,
    rpc: RpcEndpoint,
    capability: CapabilitySupplier | 'dispatches-unauthenticated',
  ) {
    this.nodeId = nodeId
    this.#rpc = rpc
    this.#capability = capability
  }

  /**
   * The frame to send for this task.
   *
   * Never an explicit `capability: undefined` key and never an empty array: this
   * project's canonical encoding treats an explicit `undefined` as a different
   * shape from an absent key, and `protocol.ts:355-356` only omits the key when the
   * field is `undefined`.
   */
  #requestFor(task: Task): CanonicalValue {
    if (this.#capability === 'dispatches-unauthenticated') {
      return encodeRequest({ kind: 'exec', task })
    }
    const chain = this.#capability(task)
    if (chain.length === 0) return encodeRequest({ kind: 'exec', task })
    return encodeRequest({ kind: 'exec', task, capability: chain })
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    let body
    try {
      body = await this.#rpc.request(this.nodeId, this.#requestFor(task))
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
