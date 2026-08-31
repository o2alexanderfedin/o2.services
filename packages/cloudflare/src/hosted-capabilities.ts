/**
 * What the hosted tier says it can do — HOST-04, and the requirement is the **omission**.
 *
 * ## The refusal this is not a workaround for
 *
 * A Cloudflare Worker cannot compile WebAssembly at runtime. The V8 embedder flag that
 * disables `eval` disables `WebAssembly.compile` and `new WebAssembly.Module` with it, and
 * `WebAssembly.instantiateStreaming` does not exist there at all. So the hosted node cannot
 * execute a fabric task, on any entry point, by construction rather than by policy.
 *
 * The requirement is not to work around that. It is to make sure the fabric is never told
 * otherwise: *"the scheduler never learns the hosted tier exists as anything but a
 * capability-limited participant."* A node that advertised execution and then failed every
 * dispatch would look, from the scheduler's side, exactly like a slow node — and the cost
 * would be paid in stragglers on a distribution whose means are already meaningless.
 *
 * ## Why `sovereignFor` is empty unconditionally, where the Node tier makes it a choice
 *
 * `fabric-node.ts`'s `recordsFrom` writes `sovereignFor: canExecuteSovereign ? [userKey] :
 * []` — an operator's decision about a node that *can* execute. Here there is no decision to
 * take: `sovereignFor` is the list of user keys whose sovereign data this node can decrypt
 * **and execute**, and the second half is unavailable. An option here would be an option to
 * publish a claim this tier cannot honour.
 *
 * ## Why the window is a parameter with no default
 *
 * `publishCapabilities` signs the validity window it is given, and the Node tier takes that
 * window from the certificate the record accompanies — so a node stops advertising
 * capabilities at exactly the moment it stops being verifiable. That is the right coupling
 * and it is the caller's to supply. Defaulting it here would mint a second lifetime policy,
 * free to drift from the certificate's, inside the one function whose entire subject is not
 * over-claiming.
 *
 * ## What this does NOT do, stated so the granularity is not read wider than it is
 *
 * **The hosted node holds no certificate.** `hostedIdentity` returns a seed and a node key
 * and nothing else, and `NodeRecords` requires a certificate beside the capabilities — so
 * the hosted tier publishes no records at all today, and HOST-04's "published" half is
 * satisfied by an absence rather than by this function. What is guarded here is the
 * **producer**: the record this tier will publish the moment hosted enrollment exists,
 * asserted to carry no execution before anything can publish one. Hosted enrollment is in
 * no requirement of this phase and is deliberately not invented here.
 *
 * ## The route not taken, and its price
 *
 * A stronger form would have the *scheduler* refuse this tier rather than merely not learn
 * of it: a **critical** `CapabilityExtension` is refused by name on every reader that does
 * not understand it (`discovery.ts`'s `unhonouredCritical`), with no core change. It is not
 * taken here because the first production extension producer reddens
 * `packages/node/src/extension-sequencing.node.test.ts` unless `DiscoveryOptions.understands`
 * gains a production caller — and *not* wiring that is a recorded owner ruling of
 * 2026-08-11, on the ground that threading an option nothing can populate reaches a check
 * that cannot fail. So the extension route costs an owner decision, and the requirement's
 * own words say it is not needed: the requirement is the omission.
 */

import { publishCapabilities } from '@o2/core'
import type { CapabilityRecord } from '@o2/core'
import type { NodeIdentity } from '@o2/libp2p'

/**
 * The validity window a capability record is signed over.
 *
 * Separate from the record so the caller cannot supply one by accident: on the Node tier
 * this is the accompanying certificate's own window, and there is no second answer that is
 * correct.
 */
export interface CapabilityWindow {
  readonly issuedAt: number
  readonly expiresAt: number
}

/**
 * The capability record the hosted tier signs — no engine features, no sovereign keys.
 *
 * Both lists are empty **as literals in this function**, not as a default something else can
 * fill in. That is what `hosted-capabilities.test.ts` asserts, and adding one entry to
 * either is the plant that reddens it.
 */
export function hostedCapabilities(
  identity: NodeIdentity,
  window: CapabilityWindow,
): CapabilityRecord {
  return publishCapabilities(identity.seed, {
    // No WASM engine feature is available here, because no WASM engine is. This is not the
    // Node tier's `features: []`, which means "this build detects none"; it means "this
    // runtime has none to detect".
    features: [],
    // See the docblock: not a decision, an unavailability.
    sovereignFor: [],
    issuedAt: window.issuedAt,
    expiresAt: window.expiresAt,
    // Stated rather than omitted, for the reason `fabric-node.ts` gives: the seam exists so
    // that "I have none" and "I forgot" are different expressions.
    extensions: [],
  })
}
