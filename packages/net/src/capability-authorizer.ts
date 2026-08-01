/**
 * `authorizeCapability` — the production caller `verifyChain` never had. AUTH-03.
 *
 * `verifyChain` (`@o2/core`'s `capability.ts`) has been complete and fuzzed since
 * Phase 4 with zero production callers; `serveAgent`'s `authorize` hook has been
 * explicit since Phase 11 with `'serves-unauthenticated'` at every production call
 * site. This module is the adapter between them: an `Authorizer` that verifies a
 * chain against a pinned owner key, this node's own audience, and an injected clock.
 *
 * ## It composes with `guardSovereignty`; it does not replace it
 *
 * The chain proves the *caller* may ask. `guardSovereignty` proves the *node* may
 * answer. The two refuse for different reasons at different points and the distinction
 * is deliberate — `sovereignty-guard.ts:16-20` states the same thing from the other
 * side. "What this node may decrypt" is not "who authorised the caller".
 *
 * ## This refusal is observable at the requestor, unlike DATA-05's
 *
 * Worth stating because a reader arriving from Phase 13.1 will expect otherwise. But
 * **not for the reason this comment gave until 2026-07-31**, which was false in a way
 * worth leaving visible: it claimed `registerSovereignInputs` never runs on a refusal.
 * No such function exists in this repository, and the mechanism that does — the
 * `takeSovereignHold` call at `agent.ts:385` — runs *before* `options.authorize` at
 * `agent.ts:405`, not after. The hold is taken, and it is still held while the refusal
 * is built.
 *
 * The conclusion survives on the real reason, which is about the frame rather than the
 * registration: a refused `exec` replies `unauthorized: <text>` and nothing else, so
 * there is no sovereign payload in it for the egress guard to match against. Phase
 * 13.1's criterion 6 — a sovereignty refusal reaching the requestor as an RPC timeout —
 * does not apply to this path. The refusal comes home as a string because the frame
 * carries no registered bytes, not because nothing was registered.
 *
 * ## Nothing here reads what kind of node it is running on
 *
 * Every node runs this identical authorizer. What differs between two nodes is the
 * `ownerId`/`ownerKey` they were configured with and the `audience` their own identity
 * yields — configuration, not class.
 *
 * Pure module: no platform imports and no libp2p, because `purity.node.test.ts` lists
 * `net` as portable. That constraint is exactly why `audienceKeyOf` lives in
 * `@o2/libp2p` and this function takes its result as a plain string.
 */

import { verifyChain } from '@o2/core'
import type { Delegation, OwnerId, PublicKeyHex, Task } from '@o2/core'
import type { Authorizer } from './agent.ts'

export interface CapabilityAuthorizerOptions {
  /** The owner this node is pinned to. */
  readonly ownerId: OwnerId
  /**
   * That owner's public key. Optional because a node may be pinned to nobody — and
   * when it is, every sovereign task naming that owner is refused, never passed.
   */
  readonly ownerKey?: PublicKeyHex
  /** This node's own key, from `@o2/libp2p`'s `audienceKeyOf`. */
  readonly audience: PublicKeyHex
  /**
   * A thunk, and deliberately not a value.
   *
   * `verifyChain` takes `now` as a *value* and states why: *"Injected so verification
   * is deterministic in tests and has no clock port"* (`capability.ts:135`). Keeping
   * the indirection one layer up preserves that property — the verifier still sees a
   * number — while letting a caller freeze time, so the expiry branch is testable
   * against a frozen clock instead of a sleep. Both node factories supply `Date.now`.
   */
  readonly now: () => number
}

/**
 * An `Authorizer` that demands a valid capability chain for sovereign tasks.
 *
 * Precedence, in this order, every refusal naming the owner or the link.
 */
export function authorizeCapability(options: CapabilityAuthorizerOptions): Authorizer {
  return (request: { readonly task: Task; readonly capability: readonly Delegation[] }) => {
    const { task } = request

    // 1. A public task is never asked for a chain.
    //
    // The decision most likely to be mistaken for an oversight, so: a public task has
    // no owner (`ShardSpec`, `submit.ts:30-32`) and therefore no root key for a chain
    // to be rooted at. Demanding one would mean inventing an owner to root it at.
    if (task.label !== 'sovereign') return null

    // 2. No pinned owner key. The safe default, consistent with
    // `canExecuteSovereign: false` — and a refusal rather than a pass precisely
    // because a node that quietly accepted would be indistinguishable from one that
    // verified.
    const { ownerKey } = options
    if (ownerKey === undefined) {
      return `no pinned owner key for ${task.ownerId ?? '(unspecified)'} on this node`
    }

    // 3. Pinned to a different owner. Names both, so a reader does not have to go
    // find the node's configuration to understand the refusal.
    if (task.ownerId !== options.ownerId) {
      return `task names owner ${task.ownerId ?? '(unspecified)'}, but this node is pinned to owner ${options.ownerId}`
    }

    // 4. The chain itself.
    //
    // `result.reason` is returned **verbatim**. `agent.ts:419` already prefixes
    // `unauthorized: `, and `describeFailure` already names the link. Nothing here
    // reformats those strings — a caller wanting to assert on them should assert on
    // `describeFailure`'s own text rather than on anything this file composes.
    const result = verifyChain(request.capability, {
      ownerKey,
      ownerId: task.ownerId,
      audience: options.audience,
      ability: 'execute',
      now: options.now(),
    })
    return result.ok ? null : result.reason
  }
}
