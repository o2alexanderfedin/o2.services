/**
 * `registerSovereignInputs` — the production caller `EgressGuard.guard()` never had.
 *
 * `EgressGuard` (`egress.ts`) is a tap: it watches every outbound frame for byte
 * patterns someone registered with `.guard()`. Registration is a separate act from
 * watching, and until this module, nothing outside a test ever performed it — the
 * only call site anywhere in the repo was `sovereign-execution.test.ts`, standing in
 * for "the owner declared this payload sovereign". A tap with nothing registered
 * cannot fail, which makes every DATA-05 check that depends on it trivially green
 * regardless of what actually happened.
 *
 * This wrapper makes the declaration automatic: at the moment a serving node is
 * about to run a `Task` labelled `'sovereign'`, it already knows the input's CID and
 * that the input is sovereign, so this is the one place in the dispatch path where
 * "register this payload" can happen without any caller remembering to do it.
 *
 * **Composed outside `guardSovereignty`, not inside it.** `guardSovereignty`
 * (`@o2/core`) refuses a sovereign task before it runs when the serving node is not
 * cleared for its owner. Registering even a task that refusal is about to reject is
 * harmless — nothing leaves on a refusal, since no `execute` call reaches the network
 * until a result is sent — and it keeps the composition order identical at both
 * production call sites (`FabricNode.start`, `BrowserNode.start`): always
 * `registerSovereignInputs(guardSovereignty(inner, sovereignty), {blockstore, guard})`,
 * never the reverse.
 *
 * **The registration blockstore is expected to be the node's local-only store, not
 * one with network fallback.** A sovereign input is owner-pinned: it must already be
 * resident on the owner's own node, by construction of what "sovereign" means in this
 * fabric. Registering from a store with network fallback would make the act of
 * *declaring* a payload sovereign itself a network round trip — fetching bytes from a
 * peer in order to tell the tap to watch for them, which defeats the point of pinning
 * the data locally in the first place.
 *
 * **A missing block is a silent skip, not a thrown error.** If the registration
 * store does not hold the task's input, the task still runs unchanged; the tap simply
 * has nothing new to watch for this one input. Throwing here would turn a tap
 * shortfall into an availability outage for a task that may otherwise complete fine
 * — the input might be fetched by the executor itself from elsewhere, or the task
 * might not need this node's local copy at all.
 *
 * Pure module: no platform imports, so it lives beside the rest of `@o2/net`'s
 * portable code (`purity.node.test.ts` enforces this).
 */

import type { Blockstore, ExecutionOutcome, Executor, Task } from '@o2/core'
import type { EgressGuard } from './egress.ts'

export interface SovereignEgressOptions {
  /** The node's local-only tier — must already hold a sovereign input's bytes. */
  readonly blockstore: Blockstore
  /** The node's own tap. Registration feeds this guard's `.guard()`, nothing else. */
  readonly guard: EgressGuard
}

/**
 * Wrap `inner` so a sovereign task's input is declared to `options.guard` before it
 * runs, whenever `options.blockstore` already holds the bytes.
 *
 * A no-op for every task whose `label` is not `'sovereign'` — `inner.execute` is
 * called unchanged, and neither the guard nor the blockstore is touched, so a public
 * task pays no extra I/O and carries no risk of being mistaken for sovereign data.
 */
export function registerSovereignInputs(inner: Executor, options: SovereignEgressOptions): Executor {
  return {
    nodeId: inner.nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      if (task.label === 'sovereign') {
        const bytes = await options.blockstore.get(task.inputCid)
        if (bytes !== undefined) {
          options.guard.guard(task.inputCid.toString(), bytes)
        }
      }
      return inner.execute(task)
    },
  }
}
