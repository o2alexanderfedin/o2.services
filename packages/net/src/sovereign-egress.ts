/**
 * `takeSovereignHold` — the production caller `EgressGuard.guard()` never had.
 *
 * `EgressGuard` (`egress.ts`) is a tap: it watches every outbound frame for byte
 * patterns someone registered with `.guard()`. Registration is a separate act from
 * watching, and until this module, nothing outside a test ever performed it — the
 * only call site anywhere in the repo was `sovereign-execution.test.ts`, standing in
 * for "the owner declared this payload sovereign". A tap with nothing registered
 * cannot fail, which makes every DATA-05 check that depends on it trivially green
 * regardless of what actually happened.
 *
 * **This was an `Executor` decorator, and is now a function `serveAgent` calls.** The
 * decorator knew *whether* a dispatch had registered anything and had nowhere to say
 * so; `serveAgent` released regardless, on the label the request named, and stripped
 * holds it never took. Taking the hold where it is given back collapses those two
 * facts into one place, and the hold is now a value only its taker can give back.
 *
 * **Composed logically outside `guardSovereignty`, exactly as before.**
 * `guardSovereignty` (`@o2/core`) refuses a sovereign task before it runs when the
 * serving node is not cleared for its owner. Taking a hold on a task that refusal is
 * about to reject is harmless — nothing leaves on a refusal — and the hold is given
 * back on that exit like any other.
 *
 * **The registration blockstore must be the node's local-only store, never one with
 * network fallback.** A sovereign input is owner-pinned: it must already be resident
 * on the owner's own node, by construction of what "sovereign" means in this fabric.
 * Registering from a store with network fallback would make the act of *declaring* a
 * payload sovereign itself a network round trip — fetching bytes from a peer in order
 * to tell the tap to watch for them, which defeats the point of pinning the data
 * locally in the first place. `AgentOptions.blockstore` is the `FetchingBlockstore`
 * at both production factories and is therefore the wrong store; `egress.sovereignInputs`
 * is the right one, and the two travel together in one option so a tap without a store
 * cannot be constructed.
 *
 * **A missing block is a silent skip, not a thrown error.** If the registration store
 * does not hold the task's input, the task still runs unchanged; the tap simply has
 * nothing new to watch for this one input. Throwing here would turn a tap shortfall
 * into an availability outage for a task that may otherwise complete fine — the input
 * might be fetched by the executor itself from elsewhere, or the task might not need
 * this node's local copy at all. Reversing that ruling was considered while fixing
 * B02 and rejected as a behaviour change beyond the bug. **The residual it leaves,
 * named:** such a dispatch runs with its input unguarded on this node, so a reply
 * carrying the raw bytes would not be refused. What is now true and was not is that
 * it strips nobody else's hold on the way.
 *
 * Pure module: no platform imports, so it lives beside the rest of `@o2/net`'s
 * portable code (`purity.node.test.ts` enforces this).
 */

import type { Blockstore, Task } from '@o2/core'
import type { EgressGuard, EgressHold } from './egress.ts'

export interface SovereignEgressOptions {
  /** The node's local-only tier — must already hold a sovereign input's bytes. */
  readonly blockstore: Blockstore
  /** The node's own tap. Registration feeds this guard's `.guard()`, nothing else. */
  readonly guard: EgressGuard
}

/**
 * Declare `task`'s input to `options.guard` and take one hold on it, or `null`.
 *
 * `null` for every task whose `label` is not `'sovereign'`, and for a sovereign task
 * whose bytes are not locally resident — in both cases neither the guard nor anything
 * else is touched, so a public task pays no extra I/O and carries no risk of being
 * mistaken for sovereign data. A caller that gets `null` has nothing to give back,
 * which is the state the old unconditional release could not represent.
 */
export async function takeSovereignHold(
  task: Task,
  options: SovereignEgressOptions,
): Promise<EgressHold | null> {
  if (task.label !== 'sovereign') return null
  const bytes = await options.blockstore.get(task.inputCid)
  if (bytes === undefined) return null
  return options.guard.guard(task.inputCid.toString(), bytes)
}
