/**
 * Asking another node for a certificate — AUTH-01, AUTH-04.
 *
 * The requesting half of the `enrol` request kind. `serveAgent`'s handler is the
 * answering half; this is what a node runs when it wants to be certified, over the same
 * `RpcEndpoint` every other request kind travels on.
 *
 * ## Three failure arms rather than one `ok: false` with an optional field
 *
 * 17-CONTEXT.md decision 9 makes an enrollment failure **fatal** to `FabricNode.start()`
 * when a provider address was given. The operator reading that line on stderr needs to
 * know whether the provider *refused them*, *could not be reached*, or *answered
 * something this build does not understand* — three different next actions:
 *
 *   `refused`       fix the request, or wait out the window
 *   `unreachable`   fix the address, the network, or start the provider
 *   `unanswerable`  the peer is up but is not a provider, or speaks a different build
 *
 * An optional field would collapse them into one value a caller has to inspect and might
 * not, which is the same shape `.planning/PROJECT.md` records as a hole.
 *
 * ## What the `unreachable` arm can and cannot reach, in production
 *
 * **This module cannot deliver that arm on its own, and saying so here is the point.**
 * By the time a caller holds an `RpcEndpoint` pointed at a peer, the dial has already
 * succeeded — so the only route into `unreachable` *from this function* is an
 * `rpc.request` failure: a timeout at the endpoint's own budget
 * (`DEFAULT_RPC_TIMEOUT_MS`, `rpc.ts`, unless the node was given a shorter
 * `rpcTimeoutMs`), a `send-failed`, a `send-refused`, or a closed endpoint.
 *
 * The case an operator actually hits — a provider address with nothing listening on
 * it — fails one step earlier, inside `libp2p.dial`, and never enters this function at
 * all. Plan 17-03 is therefore required to catch that rejection and produce **this same
 * arm and this same string**, so one code path yields the operator-facing message in
 * both cases and 17-03 asserts on that string rather than on whatever libp2p happened to
 * say.
 *
 * Pure module.
 */

import { encodeRequest, parseResponse } from './protocol.ts'
import type { EnrollmentChallenge, EnrollmentRefusal, NodeCertificate, PendingEnrollment } from '@o2/core'
import type { RpcEndpoint } from './rpc.ts'

/** The prefix every unreachable-provider message carries, on both this path and 17-03's. */
export const UNREACHABLE_PROVIDER = 'provider unreachable'

export type EnrolOutcome =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  /** The provider answered, and declined. `refusal` names which of three things was wrong. */
  | {
      readonly ok: false
      readonly kind: 'refused'
      readonly refusal: EnrollmentRefusal
      readonly reason: string
    }
  /** Something answered, but not an issuance decision this build can read. */
  | { readonly ok: false; readonly kind: 'unanswerable'; readonly reason: string }
  /** Nothing answered. See this module's header for what this arm does *not* cover. */
  | { readonly ok: false; readonly kind: 'unreachable'; readonly reason: string }

/**
 * Ask one peer to certify this node.
 *
 * Exactly one peer, deliberately — unlike `RpcRecordIndex`, which skips an unreachable
 * peer and asks the next one. Skip-and-continue is right for a lookup, where any peer
 * holding the record will do, and wrong here: enrollment is a request to a *particular*
 * authority, and a caller that could not tell which of them refused would have nothing
 * to act on.
 */
export async function enrolOverRpc(
  rpc: RpcEndpoint,
  provider: string,
  pending: PendingEnrollment,
): Promise<EnrolOutcome> {
  // Leg one: ask this provider for a nonce — AUTH-01 freshness.
  //
  // **The exchange is two round trips and cannot be one.** A joiner has to sign something
  // the provider chose, and it cannot choose it before the provider has spoken. The
  // alternatives were considered and are worse: an unsigned nonce echoed back is defeated
  // by an attacker who mints their own and staples it to a captured request, and a
  // joiner-chosen timestamp trusts the joiner's clock and needs a skew window plus a
  // per-key seen-set to bound it.
  //
  // **The second trip goes to the same peer over the same connection**, which is what keeps
  // this working over a plain dial with no reservation — the property `24-05` measured and
  // `enrolment-needs-no-reservation.node.test.ts` holds. It adds a round trip, not a
  // reachability requirement.
  const minted = await mintedBy(rpc, provider)
  if (!minted.ok) return minted

  // `answering` signs the provider's nonce with the node key this request already names —
  // and returns the *answer*, not a rebuilt request, so the fields below are this object's
  // and not a snapshot taken when it was signed. `enrollment.ts`' `PendingEnrollment` says
  // why that distinction is load-bearing.
  const request = { ...pending, freshness: pending.answering(minted.challenge) }

  let body
  try {
    body = await rpc.request(provider, encodeRequest({ kind: 'enrol', request }))
  } catch (cause) {
    return {
      ok: false,
      kind: 'unreachable',
      reason: `${UNREACHABLE_PROVIDER} ${provider}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  const response = parseResponse(body)
  if (response === null) {
    return {
      ok: false,
      kind: 'unanswerable',
      reason: `provider ${provider} sent a frame this build could not parse`,
    }
  }
  if (response.kind === 'error') {
    // The answering node's own reason, carried through verbatim. "This node issues no
    // certificates" is the one a correctly-configured non-provider sends, and it is
    // more useful to an operator than anything this function could say instead.
    return { ok: false, kind: 'unanswerable', reason: response.reason }
  }
  if (response.kind !== 'enrol') {
    return {
      ok: false,
      kind: 'unanswerable',
      reason: `provider ${provider} answered a ${response.kind} request, not an enrolment`,
    }
  }

  const { result } = response
  if (result.ok) return { ok: true, certificate: result.certificate }
  return { ok: false, kind: 'refused', refusal: result.refusal, reason: result.reason }
}

/**
 * Leg one of the exchange: get a nonce, or the same three failure arms as leg two.
 *
 * Split out so both legs produce `EnrolOutcome`'s arms rather than one of them throwing or
 * returning a second shape. The mapping is deliberately identical to the enrolment leg's,
 * because the operator-facing question is the same in both places — *were they refused,
 * unreachable, or unreadable* — and a caller that got a differently-shaped failure
 * depending on which round trip broke would have two failure vocabularies for one call.
 *
 * A provider that issues nothing answers `error` here, and its own words are carried
 * through verbatim for the reason the enrolment leg gives: "this node issues no
 * certificates" is more useful to an operator than anything this function could substitute.
 * That is what keeps the `unanswerable` reading the same whichever leg met the non-provider
 * first.
 */
async function mintedBy(
  rpc: RpcEndpoint,
  provider: string,
): Promise<
  { readonly ok: true; readonly challenge: EnrollmentChallenge } | Extract<EnrolOutcome, { ok: false }>
> {
  let body
  try {
    body = await rpc.request(provider, encodeRequest({ kind: 'enrol-challenge' }))
  } catch (cause) {
    return {
      ok: false,
      kind: 'unreachable',
      reason: `${UNREACHABLE_PROVIDER} ${provider}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  const response = parseResponse(body)
  if (response === null) {
    return {
      ok: false,
      kind: 'unanswerable',
      reason: `provider ${provider} sent a frame this build could not parse`,
    }
  }
  if (response.kind === 'error') return { ok: false, kind: 'unanswerable', reason: response.reason }
  if (response.kind !== 'enrol-challenge') {
    return {
      ok: false,
      kind: 'unanswerable',
      reason: `provider ${provider} answered a ${response.kind} request, not an enrolment challenge`,
    }
  }
  return { ok: true, challenge: response.challenge }
}
