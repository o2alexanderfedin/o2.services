/**
 * The DATA-09 serving-side gate — a node's last refusal before it runs a task.
 *
 * `NodeDescriptor.canExecuteSovereign` (`sovereignty.ts`) is where DATA-09 already
 * lives, but placement only decides where a task is *sent*; nothing on the serving
 * side had, until this module, checked whether the node that *received* it is
 * actually cleared to run it. `guardSovereignty` is that check, applied at the one
 * place that sees a `Task` and nothing else.
 *
 * Deliberately an adapter behind the unchanged `Executor` port, per Phase 2's
 * standing rule ("if it can be an adapter behind an existing port, it must be"):
 * the `Executor` interface gains no new method, `serveAgent`/`AgentOptions` need no
 * new hook, and whoever constructs a serving node's executor simply wraps it with
 * `guardSovereignty` before handing it to `serveAgent`.
 *
 * Distinct from AUTH-03's capability chains (`capability.ts`, enforced via
 * `serveAgent`'s `authorize` hook, Phase 15's concern): a capability chain proves
 * the *caller* is allowed to ask; this proves the *node* is allowed to answer.
 * "What this node may decrypt" is not "who authorised the caller", and the two
 * checks compose rather than substitute for each other.
 *
 * The ordering is the entire "before instantiation" claim: `inner.execute` for a
 * real `WasmExecutor` is what reaches `WebAssembly.instantiate`, and this function
 * never reaches that line when it refuses — the check happens first, unconditionally,
 * with no code path that calls `inner.execute` before the check completes.
 *
 * Pure module: no platform imports, so it lives in `@o2/core`.
 */

import type { ExecutionOutcome, Executor, Task } from '../ports.ts'
import type { OwnerId } from '../sovereignty.ts'

/** What a single serving node is cleared to do, for the owner it belongs to. */
export interface NodeSovereignty {
  /** The owner this node belongs to. */
  readonly ownerId: OwnerId
  /** Whether this node may actually decrypt and execute sovereign data for `ownerId`. */
  readonly canExecuteSovereign: boolean
}

/**
 * Wrap `inner` so a sovereign `Task` is refused before `inner.execute` is ever
 * called, unless it belongs to `node`'s own owner and `node` is cleared to run it.
 *
 * A no-op for every other task: `label: 'public'` or `label` absent (matching every
 * pre-Phase-12 `Task` literal in the repo) always reaches `inner.execute` unchanged,
 * regardless of `node.canExecuteSovereign`.
 */
export function guardSovereignty(inner: Executor, node: NodeSovereignty): Executor {
  return {
    nodeId: inner.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      if (task.label === 'sovereign') {
        const cleared = task.ownerId === node.ownerId && node.canExecuteSovereign
        if (!cleared) {
          return {
            ok: false,
            reason: `sovereignty violation: node ${inner.nodeId} is not cleared to execute sovereign data for owner ${task.ownerId ?? '(unspecified)'}`,
          }
        }
      }
      return inner.execute(task)
    },
  }
}
