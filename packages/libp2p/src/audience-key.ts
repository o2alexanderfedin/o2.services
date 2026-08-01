/**
 * `audienceKeyOf` — the ed25519 public key a capability chain must end at, recovered
 * from the libp2p peer id both ends of a dispatch already hold. AUTH-03.
 *
 * ## Why the peer id, rather than new key material
 *
 * `VerifyOptions.audience` (`@o2/core`'s `capability.ts`) is an ed25519 public key in
 * hex, and the chain must end by delegating to *this* node. The obvious alternatives —
 * enroll a separate audience key, ship a key file, add a protocol request that asks a
 * node for its key — all introduce something to distribute and keep in step. The peer
 * id needs none of that: the serving node computes this from its own `libp2p.peerId`,
 * and the requestor computes the byte-identical key from the `nodeId` string it already
 * passes as `new RemoteExecutor`'s first argument.
 *
 * The binding is the reason to prefer it, not merely the convenience. Only the holder
 * of that private key could have completed the noise handshake as that peer id, so the
 * chain's audience and the authenticated transport identity are the same key by
 * construction.
 *
 * ## What this does not prove
 *
 * `verifyChain` never asks the audience to sign anything — it compares the final
 * audience as an opaque string. So this is a binding *by construction*, not a proof of
 * possession. The challenge-response that would prove possession is `enrollment.ts`'s
 * `possessionChallenge`, and it belongs to Phase 17.
 *
 * ## Why this refuses rather than returning something plausible
 *
 * Because `verifyChain` compares the audience as an opaque string, a silently wrong
 * derivation does not surface here — it surfaces much later as `wrong-audience`, whose
 * text reads *"chain ends at X, but this node is Y"*. That is a refusal meaning *the
 * chain was minted for another node*, which is a completely different investigation
 * from *this node's identity is the wrong algorithm*. An RSA node would send a reader
 * hunting through the requestor's minting code for a bug that is not there. So both
 * defects are named at the point they are detectable.
 *
 * Lives in `@o2/libp2p` because it touches libp2p and `@o2/core`/`@o2/net` may not.
 * `@o2/net`'s authorizer takes the result as a plain string, so the portable tier stays
 * portable — `purity.node.test.ts` enforces both halves of that.
 */

import type { PeerId } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { toHex } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'

/**
 * The hex-encoded ed25519 public key behind `peer`, in the form
 * `VerifyOptions.audience` wants.
 *
 * Accepts the peer id in either form deliberately: a serving node has a `PeerId`
 * object, a requestor has only the string it was handed, and both must arrive at the
 * same answer or no chain either of them mints could ever verify.
 *
 * @throws if the identity is not Ed25519, or carries no public key at all.
 */
export function audienceKeyOf(peer: PeerId | string): PublicKeyHex {
  const peerId = typeof peer === 'string' ? peerIdFromString(peer) : peer
  const name = typeof peer === 'string' ? String(peer) : peerId.toString()

  // The order of these two checks is not stylistic and must not be swapped.
  //
  // `PeerId` is a union, and `publicKey` is optional on the RSA member and typed
  // `undefined` on the URL member while being required on the Ed25519 one. Once the
  // union is narrowed to the Ed25519 member, `publicKey` is no longer optional and a
  // comparison against `undefined` becomes a type error rather than a check — the
  // compiler would report comparing non-overlapping types, and the natural "fix" is to
  // delete the check that was doing the work. So the absence test has to happen while
  // the union still admits absence, which means before the narrowing on `type`.
  const { publicKey } = peerId
  if (publicKey === undefined) {
    throw new Error(
      `peer ${name} carries no public key, so no audience key can be recovered from it`,
    )
  }

  if (peerId.type !== 'Ed25519') {
    throw new Error(
      `peer ${name} is of type ${peerId.type}, and only Ed25519 identities can be a capability chain's audience`,
    )
  }

  // `toHex` rather than a second hex encoder: this string is compared byte-for-byte
  // against what `delegate` wrote into a chain, and two encoders are two chances to
  // disagree about case or padding.
  return toHex(publicKey.raw)
}
