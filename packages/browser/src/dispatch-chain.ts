/**
 * Capability chains minted **in a tab**, for a key the tab cannot read — AUTH-03's
 * browser half.
 *
 * `bin/agent.ts`'s sovereign coordinator leg closed AUTH-03 on the command line: it hands
 * `discoverCandidates` a `(nodeId) => CapabilitySupplier`, so every `RemoteExecutor` it
 * builds carries a chain rooted at the task's own owner and addressed to the exact node.
 * This module is the same move on the browser tier, and the two differences are the whole
 * of it.
 *
 * ## Difference one — there are no key bytes, so the chain is minted through a port
 *
 * A visitor's owner key is generated `extractable: false`, and `exportKey` on the private
 * half is refused in chromium, firefox and webkit. That refusal *is* the property being
 * bought: the origin that served the page cannot read the key. So `delegate(seed, …)` is
 * not available here and never will be; `delegateWith(signer, …)` is, and `subtleUserSigner`
 * supplies the signer over the pair `visitorKeyPair()` keeps in IndexedDB.
 *
 * ## Difference two — signing is asynchronous and the supplier is not
 *
 * `CapabilitySupplier` is `(task) => readonly Delegation[]`, called on the dispatch path
 * with no opportunity to await. `crypto.subtle.sign` returns a Promise and nothing portable
 * awaits one synchronously — `ed25519-backend.ts` records that measurement and the two
 * failed escapes, `Atomics.wait` among them, which needs cross-origin isolation the
 * declared GitHub Pages target cannot supply.
 *
 * **So the chains are minted ahead of dispatch and the supplier serves what was minted.**
 * That is why this is an `async` factory returning a synchronous lookup rather than a
 * supplier that signs on demand. The cost is that the node set has to be known first, which
 * it is: the page discovers candidates before it submits.
 *
 * ## What a tab may root a chain at, and it is exactly one key
 *
 * **Its own.** `verifyChain` refuses a chain whose root is not the serving node's pinned
 * `ownerKey`, so a chain this tab signs is accepted only by nodes pinned to *this tab's*
 * user key. A visitor who types somebody else's owner id into the bring-your-own box is
 * asking for a chain this tab cannot produce, and {@link chainsForOwner} answers `null`
 * rather than minting one that would be refused as `wrong-root` — a refusal naming a cause
 * the visitor could not act on.
 *
 * That is not a limitation being worked around. It is the sovereignty claim stated
 * honestly: *a tab may speak for its own owner and for nobody else.* The alternative —
 * signing something and letting the far end reject it — would put a page in the position of
 * making claims on behalf of an owner it cannot represent.
 *
 * ## Why `null` and not a supplier returning `[]`
 *
 * `[]` is the **correct** answer for a public task, which `authorizeCapability` disposes of
 * before it looks at a chain at all. A supplier that returned `[]` for an owner it cannot
 * root at would therefore be indistinguishable from one working normally, and the caller
 * would dispatch unauthenticated while believing it had wired a chain. `main.ts`'s standing
 * note names that exact hazard — *"claiming otherwise by passing a supplier that produced
 * none would be worse than saying so."* A `null` makes the caller choose.
 */

import { delegateWith } from '@o2/core'
import type { Delegation, DelegationSigner, PublicKeyHex } from '@o2/core'
import { audienceKeyOf } from '@o2/libp2p'
import type { CapabilitySupplier } from '@o2/net'

/**
 * How long a minted chain is good for.
 *
 * **One hour, matching `bin/agent.ts`'s `CHAIN_TTL_MS` deliberately.** The two entry points
 * mint for the same fabric and a reader comparing them should not have to work out whether a
 * difference is meaningful. It is computed per call rather than per module so a tab left
 * open overnight does not dispatch against an expiry set when the page loaded.
 */
export const TAB_CHAIN_TTL_MS: number = 60 * 60 * 1000

/** What {@link chainsForOwner} needs beyond the signer and the nodes. */
export interface TabChainOptions {
  /** The owner the shards will be pinned to. Must equal the signer's own key. */
  readonly ownerId: string
  /** The peer ids that may be dispatched to. One delegation is minted per entry. */
  readonly nodeIds: readonly string[]
  /** Injected rather than read, so a test can pin an expiry without pinning a clock. */
  readonly now: () => number
  /** Overridable for tests; defaults to {@link TAB_CHAIN_TTL_MS}. */
  readonly ttlMs?: number
}

/**
 * Mint one delegation per node, ahead of dispatch, and return the supplier factory
 * `discoverCandidates` and `RemoteExecutor` both take.
 *
 * Returns `null` — and mints nothing — when `ownerId` is not the signer's own key. See the
 * module docblock for why that is a refusal rather than an empty supplier.
 *
 * ## A function OF THE NODE ID, which is not incidental
 *
 * A chain's audience must be the node it is sent to: one minted for node A is refused at
 * node B as `wrong-audience`. So a single supplier shared across a candidate set can name at
 * most one audience and would be wrong for every node but one. `audienceKeyOf` derives the
 * audience from the peer id, and it is the identical derivation the serving node applies to
 * its own `libp2p.peerId` — nothing is exchanged to make the two agree.
 *
 * ## The returned supplier answers `[]` for a public task, and that is the contract
 *
 * `authorizeCapability` returns `null` for a task with no owner before it ever looks at a
 * chain, so a public task has no key a chain could be rooted at. The supplier is per
 * executor and an executor built here may be handed either kind, so the branch is live
 * rather than defensive.
 */
export async function chainsForOwner(
  signer: DelegationSigner,
  options: TabChainOptions,
): Promise<((nodeId: string) => CapabilitySupplier) | null> {
  // The one check that decides whether this tab may speak for this owner at all. Compared
  // against the SIGNER's key rather than against the node's certificate: the certificate
  // says who enrolled this tab, the signer says what it can actually produce a signature
  // for, and it is the second that a far-end `verifyChain` will test.
  if (options.ownerId !== signer.userKey) return null

  const expiresAt = options.now() + (options.ttlMs ?? TAB_CHAIN_TTL_MS)
  const minted = new Map<string, readonly Delegation[]>()

  // Sequential rather than `Promise.all`, because each `sign` is a `crypto.subtle` call and
  // a tab dispatching to a handful of peers gains nothing measurable from overlapping them
  // — while a rejection inside a settled batch is markedly harder to attribute to the node
  // it belongs to.
  for (const nodeId of options.nodeIds) {
    const audience: PublicKeyHex = audienceKeyOf(nodeId)
    minted.set(nodeId, [
      await delegateWith(signer, {
        ownerId: options.ownerId,
        audience,
        abilities: ['execute'],
        expiresAt,
      }),
    ])
  }

  return (nodeId: string): CapabilitySupplier => {
    const forNode = minted.get(nodeId)
    return (task): readonly Delegation[] => {
      if (task.label !== 'sovereign' || task.ownerId === undefined) return []
      // A throw and never an empty list, for the reason the module docblock gives: `[]` is
      // the correct answer one line above and would here be indistinguishable from it. A
      // node this factory was not given cannot be dispatched to under a chain, and sending
      // the shard unauthenticated instead is the thing that must not happen silently.
      if (forNode === undefined) {
        throw new Error(
          `no chain was minted for ${nodeId}, so an owner-pinned shard cannot be dispatched ` +
            'to it — the node set changed after the chains were minted',
        )
      }
      if (task.ownerId !== options.ownerId) {
        throw new Error(
          `a task is pinned to owner ${task.ownerId}, and this tab can only root a chain at ` +
            `${options.ownerId}, which is its own key`,
        )
      }
      return forNode
    }
  }
}
