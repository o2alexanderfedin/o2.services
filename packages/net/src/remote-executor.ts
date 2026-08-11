/**
 * `RemoteExecutor` — the adapter that makes another machine look like a local one.
 *
 * This is the whole reason the kernel is unchanged by the arrival of a network.
 * `submitJob` takes `Executor[]` and does not care where one runs; an executor
 * whose `execute` happens to cross a wire satisfies the same contract as one that
 * calls into V8 directly. The redundancy and verification logic is untouched.
 *
 * **This class implements two ports, and the second one is why VER-02 exists at all.**
 * `commit` and `reveal` are the two rounds of the ceremony (`@o2/core`'s
 * `CommittingExecutor`), and they are here rather than in a class of their own because
 * they are the same dispatch to the same peer under the same capability chain — a second
 * class would be a second place for the chain selection to drift, and the drift would be
 * a commit dispatched unauthenticated where the exec would not have been.
 *
 * That the two ports are *declared* separately and *implemented* together is the point.
 * `isCommitting` asks the object rather than the caller, so a remote executor takes the
 * ceremony path and a kernel-local one does not, and neither had to be told.
 *
 * The sentence above about commit-reveal read *"the redundancy, commit-reveal, and
 * verification logic is untouched"* from Phase 2 until 2026-08-11, and for most of that
 * span it named a mechanism that had been deleted (`855cdf5`, 2026-07-30) — a comment
 * asserting a guarantee the tree did not carry, which is the failure mode this file's
 * header already has one paragraph about. It now names what is here.
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
 * AUTH-03: the minting side **is reached from production**, as of Phase 23.
 *
 * What stood here until 2026-08-06 said the opposite, and said it with authority it
 * did not have. It recorded that every non-test `new RemoteExecutor(` site dispatches
 * public work, that `delegate` is therefore called only from tests, that of three
 * options considered "the third was taken" — the requestor half accepted as
 * entry-point-unreachable — and it closed by instructing the reader that if this
 * comment and the roadmap ever disagreed, this comment was the one to believe.
 *
 * Three of those claims are now false and the fourth was never this comment's to make.
 * `bin/bench.ts` does not label every shard `'public'`; a `'sovereign'`-labelled shard
 * is in the file. `delegate` has two production call sites there — one at module scope
 * and one inside `sovereignSupplierFor`. And "the third was taken" names the option the
 * owner **overruled on 2026-07-31**: the ruling was *naming that is not fixing it*, and
 * the work was routed to Phase 23 criterion 5, which delivered it. `ROADMAP.md` marks
 * the corresponding paragraph *"Superseded — do not read the paragraph below as the
 * standing decision."* This comment was that superseded decision, unmarked, sitting
 * where Phase 22's author would read it first.
 *
 * **The precedence clause is deleted rather than re-pointed.** A comment does not
 * outrank a requirement in this repository — when the two disagree the requirement wins
 * and the comment gets fixed, which is what happened here. `23-VERIFICATION.md` records
 * the measurement.
 *
 * What is still open is narrower and belongs to nobody in this file: the leg is reached
 * only behind `--discover --sovereign`, both off by default, and whether a twice-flag-gated
 * path counts as *entry-point reachable* is **Phase 22's guard's ruling**. AUTH-03 stays
 * `Partial` until that guard runs.
 *
 * Pure module.
 */

import type {
  CanonicalValue,
  CommitOutcome,
  CommittingExecutor,
  Delegation,
  ExecutionOutcome,
  Executor,
  RevealOutcome,
  Task,
} from '@o2/core'
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

export class RemoteExecutor implements Executor, CommittingExecutor {
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
  #requestFor(kind: 'exec' | 'commit', task: Task): CanonicalValue {
    if (this.#capability === 'dispatches-unauthenticated') {
      return encodeRequest({ kind, task })
    }
    const chain = this.#capability(task)
    if (chain.length === 0) return encodeRequest({ kind, task })
    return encodeRequest({ kind, task, capability: chain })
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    let body
    try {
      body = await this.#rpc.request(this.nodeId, this.#requestFor('exec', task))
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

  /**
   * VER-02 round 1 — the same task, over the same chain, with the answer withheld.
   *
   * The chain is selected by `#requestFor` exactly as it is for an `exec`, which is the
   * half of this method that would be easy to get wrong and expensive to have wrong: a
   * commit dispatched unauthenticated where the matching exec would have carried a chain
   * is a peer running the owner's work without the owner's say-so, and collecting it in
   * round 2 having never been entitled to round 1.
   *
   * Every transport and protocol fault becomes `{ ok: false, reason }` for
   * `execute`'s reason, and it matters more here: `executeCommitReveal` counts
   * commitments against {@link MIN_CEREMONY_REPLICAS} and must be able to tell *this
   * node did not commit* from *the whole ceremony threw*.
   */
  async commit(task: Task): Promise<CommitOutcome> {
    let body
    try {
      body = await this.#rpc.request(this.nodeId, this.#requestFor('commit', task))
    } catch (cause) {
      return {
        ok: false,
        reason: `commit dispatch to ${this.nodeId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }
    const response = parseResponse(body)
    if (response === null) return { ok: false, reason: `malformed response from ${this.nodeId}` }
    if (response.kind === 'error') {
      return { ok: false, reason: `remote error from ${this.nodeId}: ${response.reason}` }
    }
    if (response.kind !== 'commit') {
      return { ok: false, reason: `unexpected ${response.kind} response to commit request` }
    }
    return response.outcome
  }

  /**
   * VER-02 round 2 — hand back the handle this node minted, and take the answer.
   *
   * The handle goes back **unread**. This class never parses it, never derives anything
   * from it, and has no opinion about its shape: it is the serving node's name for its
   * own pending answer, and the moment a requestor started interpreting it the serving
   * node would have lost the ability to change how it names things without breaking
   * every peer.
   */
  async reveal(handle: string): Promise<RevealOutcome> {
    let body
    try {
      body = await this.#rpc.request(this.nodeId, encodeRequest({ kind: 'reveal', handle }))
    } catch (cause) {
      return {
        ok: false,
        reason: `reveal request to ${this.nodeId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }
    const response = parseResponse(body)
    if (response === null) return { ok: false, reason: `malformed response from ${this.nodeId}` }
    if (response.kind === 'error') {
      return { ok: false, reason: `remote error from ${this.nodeId}: ${response.reason}` }
    }
    if (response.kind !== 'reveal') {
      return { ok: false, reason: `unexpected ${response.kind} response to reveal request` }
    }
    return response.outcome
  }
}
