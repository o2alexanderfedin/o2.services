/**
 * CAP-01's serving-side gate — a node refuses a task whole when its module declares
 * network reach and the task is dispatched against sovereign data, before
 * `inner.execute` is ever called.
 *
 * `naming.ts`'s `NameRecord.wantsNetworkReach` (Phase 46, plan 01) and its wire form
 * in `protocol.ts` (plan 02) already carry a publisher's signed wish for network
 * reach end to end, from signature to the serving node's own `Task`. Nothing had,
 * until this module, read that field and turned it into a refusal. This is that
 * read.
 *
 * **Composition: the third adapter, between `guardSovereignty` and
 * `guardModuleProvenance`.** Both node factories build the same shape —
 * `fabric-node.ts:2929` and `browser-node.ts:2532` —
 * `guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty)`, where
 * `provenance` is each factory's own closure over `guardModuleProvenance` (or the
 * identity function on a `runs-unsigned-artifacts` node). `guardSovereignty` stays
 * outermost and `provenance` stays innermost, unchanged from before this phase; this
 * guard sits between them.
 *
 * **Why inside `guardSovereignty` and not outside it.** A refusal about the (module,
 * data) pair only means something on the node that is the right node for that data
 * in the first place — and `guardSovereignty` is what has already established that,
 * by the time this guard runs. Running this guard on a node that is not even cleared
 * for the owner would refuse for the wrong reason, or not refuse at all if the
 * sovereignty check had not yet ruled the task out.
 *
 * **Why a separate adapter and not a branch inside `guardModuleProvenance` after
 * `accept()` succeeds.** This check must still apply when `provenance` is the
 * identity wrapper a `runs-unsigned-artifacts` node substitutes for
 * `guardModuleProvenance` — a branch living inside that guard would vanish along
 * with it on exactly the node shape Plan 05's composition tests exercise. A separate
 * adapter composes onto both node shapes unchanged; a branch inside `provenance`
 * would only compose onto one of them.
 *
 * **Reading `task.moduleRecord.wantsNetworkReach` before it is verified is
 * safe only because this phase refuses and never grants.** Nothing below calls
 * `provenance.resolver.accept` or any other verification — it reads a field off
 * whatever record the dispatcher attached to the task, unverified, and acts on it.
 * A forged declaration refuses its own forger, and lying in it wins nothing, because
 * the only thing a lie can produce on this path is an extra refusal of the task the
 * liar dispatched. The moment a grant decision exists that reads this same field,
 * this ordering argument stops holding, and
 * a grant must never be made at a point that reads an unverified record
 * — a grant is exactly the direction in which an unverified read can be turned into
 * a bypass, and refusal is the one direction in which it cannot.
 *
 * The ordering is the entire "before instantiation" claim, restated for this
 * guard's own subject: `inner.execute` for a real `WasmExecutor` is what reaches
 * `WebAssembly.instantiate`, and this function never reaches that line when it
 * refuses — the check happens first, unconditionally, with no code path that calls
 * `inner.execute` before the check completes.
 *
 * Pure module: no platform imports, so it lives in `@o2/core`.
 */

import type { ExecutionOutcome, Executor, Task } from '../ports.ts'

/** Why a task was refused for the module's declared reach. */
export type NetworkReachRefusal = {
  readonly kind: 'declared-against-sovereign'
  readonly moduleCid: string
  readonly label: 'sovereign'
}

/**
 * Exhaustive by construction, with no `default` arm — the shape
 * `describeModuleRefusal` already uses, so a second variant is a compile error
 * rather than a silent fallthrough into wording nobody wrote.
 */
export function describeNetworkReachRefusal(refusal: NetworkReachRefusal): string {
  switch (refusal.kind) {
    case 'declared-against-sovereign':
      return `module ${refusal.moduleCid} declares network reach (wantsNetworkReach), and the task is labelled sovereign — a module that wants the internet cannot run against sovereign data`
  }
}

/**
 * Wrap `inner` so a task is refused whole, before `inner.execute` runs, exactly when
 * its module declares network reach and its label is sovereign.
 *
 * A no-op in every other case: public label with a declaring module, sovereign
 * label with a non-declaring or absent module record, and a task with no label at
 * all all reach `inner.execute` unchanged. There is no config parameter — the rule
 * reads only fields the dispatcher supplied on `task` itself.
 */
export function guardNetworkReach(inner: Executor): Executor {
  return {
    nodeId: inner.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      if (task.label === 'sovereign' && task.moduleRecord?.wantsNetworkReach === true) {
        const refusal: NetworkReachRefusal = {
          kind: 'declared-against-sovereign',
          moduleCid: task.moduleCid.toString(),
          label: 'sovereign',
        }
        return { ok: false, reason: `network reach refused on ${inner.nodeId}: ${describeNetworkReachRefusal(refusal)}` }
      }
      return inner.execute(task)
    },
  }
}
