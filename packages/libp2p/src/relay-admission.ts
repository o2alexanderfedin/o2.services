/**
 * AUTH-02 / AUTH-04 — who a relay lets in, stated by the operator and read by nobody yet.
 *
 * ## What this is for
 *
 * A node's lifecycle in this fabric begins at the relay reservation. Both advertisement
 * surfaces are derived from the reservation store — `seed-server.ts` maps
 * `node.reservedPeerIds` into `BootstrapInfo.peerAddrs`, and `@o2/net`'s `agent.ts`
 * answers its `reservations` branch from the same thunk — so a peer that never obtains a
 * reservation appears in neither, *structurally*, with no filter to add and no `if` to
 * forget. That is the argument for putting an admission decision here rather than at any
 * of the four places a certificate is already checked.
 *
 * **Every one of those four is SELECTION, not ADMISSION.** `PeerVerifier`,
 * `discoverExecutors`, `discoverCandidates`/`resolveReplicaSets` and
 * `verifyResultAttestation` all decide who to *use*. None decides who gets *in*. Until
 * something reads this value, that is still true and this file changes it in no way — see
 * "Consulted by nothing" below.
 *
 * ## Why a required named union, and not an optional set
 *
 * ```
 * RelayAdmission = ReadonlySet<PublicKeyHex> | 'admits-any-peer'
 * ```
 *
 * - **Non-empty set** — only a peer whose certificate chains to a pinned issuer is granted
 *   a reservation.
 * - **Empty set** — admits nobody. Genuinely fail-closed, and not a hole.
 * - **`'admits-any-peer'`** — today's behaviour on every node in this repository, **stated
 *   by name** rather than arrived at by omission.
 *
 * There is no "empty means everyone" reading, because the everyone case *has a name*. An
 * optional field would leave a caller able to mean "admit everyone" without ever having
 * said so, and silence and consent would be indistinguishable at the one boundary where
 * the difference is the whole security claim. This repository has twice measured that
 * shape as `tsc --noEmit` exit 0 beside a failing behavioural assertion — the argument is
 * written out at `IssuanceBudget`'s docblock and again at `ownStartLedger`'s, and it is
 * the established answer to this class here: `'keeps-no-ledger'`, `'serves-no-records'`,
 * `'signs-nothing'`, `'relays-for-nobody'`, `'checks-no-combine-signatures'`,
 * `'carries-no-certificate'`.
 *
 * ## The asymmetry with `PeerVerifier`, written here because it is written there too
 *
 * `PeerVerifier.verifiedPeers` opens with `if (this.#trustedIssuers.size === 0) return
 * this.#peers()` — **pinned nobody ⇒ trust everybody**. That is fail-*open*, it is
 * deliberate, and it is not flipped: that early return is what makes *"a node with no
 * trust anchors has no verdicts"* true by construction and what makes the empty-anchor
 * case cost exactly nothing.
 *
 * **The reservation path does not share that reading and must never acquire it.** An
 * empty set here admits nobody. The two mechanisms therefore do not read one value two
 * ways — they read *different types*, which is the whole reason this is a union rather
 * than a set. A matching sentence sits at `PeerVerifier.verifiedPeers`'s early return,
 * because an asymmetry recorded at only one of two lines gets "fixed" back from the other.
 *
 * ## Consulted by nothing — a claim this file makes about itself
 *
 * As of the plan that introduced it, **no code reads this value.** No `ConnectionGater` is
 * constructed anywhere in this repository except `browser-node.ts`'s
 * `{ denyDialMultiaddr: async () => false }`, which *opens* dialling; `circuitRelayServer`
 * is still passed capacity limits and nothing else. The mechanism that will read it is
 * `@libp2p/interface`'s optional `ConnectionGater.denyInboundRelayReservation(source)`,
 * which `@libp2p/circuit-relay-v2`'s server calls with `?.` and refuses on `=== true`.
 *
 * Three properties make that the right hook, and each is load-bearing:
 *
 *   1. It fires on the **reservation** and on nothing else, so a plain connection — the one
 *      enrolment uses — never reaches it. The enrolment exemption is by construction rather
 *      than by an `if`.
 *   2. It is optional-called, so a node supplying no gater behaves exactly as today.
 *   3. It is **per-peer**, so holding a certificate stays a fact about a node and never a
 *      node kind.
 *
 * ## The deployment requirement, written where a deployment reads it
 *
 * **A relay that pins issuers must either serve enrolment itself, or name a provider a
 * joining peer can reach without a reservation.** Otherwise a node that has never been
 * certified cannot obtain a first certificate, and the door is shut on the only route
 * through it. Today the two are co-located — for a browser tab the provider and the relay
 * are the same node at the same address — and the enforced mechanism above keeps a
 * pre-certificate connection able to carry `enrol` regardless. This sentence exists
 * because a constraint living only in a planning document reaches nobody reading the code.
 *
 * ## The revocation window is the reservation TTL
 *
 * Admission is checked at every reservation **grant**, renewals included; nothing
 * re-checks a peer mid-reservation, deliberately, because a connection-level re-check is a
 * fabric-wide behaviour change of the class this repository has already held for an owner
 * ruling once. So the window in which a peer whose certificate has lapsed still holds a
 * reservation is bounded by {@link RELAY_MAX_RESERVATION_TTL_MS} (or whatever
 * `reservationTtlMs` a node was given), and that is stated here rather than implied.
 *
 * **Two things that rests on are MEASUREMENTS not yet taken**, and are recorded as open
 * rather than assumed: that `@libp2p/circuit-relay-v2` re-consults the gater on a renewal
 * and not only on a first grant — if it does not, the window is unbounded and that is a
 * finding to report rather than a case to fake — and that `expired` staying out of
 * `PeerVerifier`'s `FINAL` set composes with this, so a lapsed peer fails at its next
 * renewal rather than being cached as permanently refused.
 *
 * ## It is not a node kind
 *
 * This is a value on the **relay's** options describing who *it* admits. It says nothing
 * about what kind of thing the peer is, and nothing anywhere may branch on which factory
 * built a peer. All nodes have equal functionality; the only difference between them is
 * discovery.
 */

import type { PublicKeyHex } from '@o2/core'

/**
 * Who a relay grants a circuit reservation to — see this module's comment in full.
 *
 * A `ReadonlySet` rather than an array because membership is the only question ever asked
 * of it, and because an array would make "the same issuer listed twice" a state the type
 * permits and a reader has to think about.
 */
export type RelayAdmission = ReadonlySet<PublicKeyHex> | 'admits-any-peer'

/**
 * The name of the open posture, as a value.
 *
 * Exported so a call site can be found by symbol rather than by grepping a string literal,
 * and so the one place the text is written is this file. Call sites still write the
 * literal — `relayAdmission: 'admits-any-peer'` reads as a statement where
 * `relayAdmission: ADMITS_ANY_PEER` reads as a constant — which is deliberate and is the
 * same trade `'dispatches-unauthenticated'` records: hoisting a sentinel into a constant
 * takes the count that watches it to 1 and makes the floor unreadable.
 */
export const ADMITS_ANY_PEER = 'admits-any-peer'

/**
 * Whether this posture admits a peer holding no certificate at all.
 *
 * A predicate rather than a comparison at each call site, so that when 24-03 arms the
 * gate there is one place that decides what the union *means* and not one per reader.
 * **Nothing calls this yet**, which is this plan's defining property; it exists so the
 * arming plan adds a caller rather than a semantics.
 */
export function admitsAnyPeer(admission: RelayAdmission): boolean {
  return admission === ADMITS_ANY_PEER
}
