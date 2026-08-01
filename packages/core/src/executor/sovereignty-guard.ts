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
 * Distinct from AUTH-03's capability chains (`capability.ts`): a capability chain
 * proves the *caller* is allowed to ask; this proves the *node* is allowed to
 * answer. "What this node may decrypt" is not "who authorised the caller", and the
 * two checks compose rather than substitute for each other.
 *
 * As of Phase 15 that chain is enforced, not merely described. `authorizeCapability`
 * (`packages/net/src/capability-authorizer.ts`) is installed as `serveAgent`'s
 * `authorize` hook by both node factories, and the two checks fire in a fixed order:
 * `authorize` first, `execute` — and therefore this guard — second.
 *
 * The consequence a reader will otherwise meet as a surprise: on a node with no
 * pinned owner key, the authorize refusal now arrives *before* this guard runs. So
 * this guard's own refusal text is observable only on a node that is pinned to an
 * owner and given that owner's key and still not cleared to execute for them. That
 * is the one node shape DATA-09's production-path test now has to construct
 * (`packages/node/src/fabric-node.node.test.ts`), and it is why the field below
 * exists on this record even though nothing in this file reads it.
 *
 * The ordering is the entire "before instantiation" claim: `inner.execute` for a
 * real `WasmExecutor` is what reaches `WebAssembly.instantiate`, and this function
 * never reaches that line when it refuses — the check happens first, unconditionally,
 * with no code path that calls `inner.execute` before the check completes.
 *
 * Pure module: no platform imports, so it lives in `@o2/core`.
 */

import type { PublicKeyHex } from '../capability.ts'
import type { ExecutionOutcome, Executor, Task } from '../ports.ts'
import type { OwnerId } from '../sovereignty.ts'

/** What a single serving node is cleared to do, for the owner it belongs to. */
export interface NodeSovereignty {
  /** The owner this node belongs to. */
  readonly ownerId: OwnerId
  /** Whether this node may actually decrypt and execute sovereign data for `ownerId`. */
  readonly canExecuteSovereign: boolean
  /**
   * AUTH-03's pinned trust anchor: the ed25519 public key, hex-encoded, that a
   * capability chain for `ownerId` must be rooted at.
   *
   * **Why it lives on this record rather than beside it.** `ownerId` and `ownerKey`
   * name the same owner and must never disagree. 13-CONTEXT.md decision 2 already
   * had to hoist the sovereignty default into a single resolved value in both node
   * factories, precisely because two independently-defaulted copies drift. One
   * record, resolved once, now feeds three consumers: `EgressGuard`'s owner id,
   * `guardSovereignty`'s clearance check, and the authorizer's owner and key.
   *
   * **`guardSovereignty` ignores it, deliberately.** This record is *what this node
   * is configured about its owner*; the two gates read different fields of it to
   * answer different questions. Adding this field changes the behaviour of the
   * function below by exactly nothing, which is what lets that function's existing
   * tests stand untouched.
   *
   * **Absent means no pinned owner key**, and the authorizer turns that into a
   * refusal of every sovereign task naming this owner, with a stated reason. The
   * safe default, consistent with `canExecuteSovereign: false` — and a refusal
   * rather than a pass because a node that quietly accepted would be
   * indistinguishable from one that verified.
   *
   * This node cannot tell a correct pin from a wrong one. It is configuration, and
   * the operator supplies it; the provider-signed path that would make the anchor
   * itself verifiable is AUTH-01/02, Phase 17.
   */
  readonly ownerKey?: PublicKeyHex
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
