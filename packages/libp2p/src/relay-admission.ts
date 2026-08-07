/**
 * AUTH-02 / AUTH-04 — who a relay lets in, stated by the operator and read at the
 * reservation.
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
 * `verifyResultAttestation` all decide who to *use*. None decides who gets *in*. This
 * value is the one that does, and since Plan 24-03 it is read — see "Who reads this" below.
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
 * ## Who reads this — a claim this file makes about itself, corrected 2026-08-06
 *
 * **This section used to be headed "Consulted by nothing" and said that no code reads this
 * value and that no `ConnectionGater` is constructed anywhere except `browser-node.ts`'s.
 * Both were true for one wave and are false now**, and the correction is recorded rather
 * than swapped in silently, because a comment asserting a mechanism is inert is the exact
 * shape this repository has been bitten by: a reader who believes it stops looking.
 *
 * `fabric-node.ts`'s `relayAdmissionGate` reads this value — via {@link admitsAnyPeer}, its
 * single production caller — and `createLibp2p` is handed
 * `connectionGater: { denyInboundRelayReservation: gate }` by a conditional spread. The
 * spread is conditional because the gate returns `undefined` for the open posture, so an
 * open node supplies **no gater method at all** and is byte-identical to the tree before
 * this file existed. `browser-node.ts`'s `{ denyDialMultiaddr: async () => false }` is still
 * there and still only *opens* dialling; a `BrowserNode` imports `circuitRelayTransport` and
 * never `circuitRelayServer`, so it runs no relay server, grants no reservation, and has no
 * reservation to gate. `circuitRelayServer` is still passed capacity limits and nothing
 * else, and `relay-admission.node.test.ts`'s census pins all three of those facts —
 * including that a *third* production gater appearing is a failure.
 *
 * The mechanism that reads it is `@libp2p/interface`'s optional
 * `ConnectionGater.denyInboundRelayReservation(source)`, which `@libp2p/circuit-relay-v2`'s
 * server calls with `?.` and refuses on `=== true`, writing `PERMISSION_DENIED`. That is
 * **per-relay by construction** — a fact worth stating here because it bounds the claim the
 * whole file supports: a peer this relay refuses is refused *here*, and any other
 * relay-capable peer it can reach decides for itself. `24-VERIFICATION.md` scores criterion
 * 8 PARTIAL on exactly that, because a joiner must dial an enrolment provider that is itself
 * relay-capable.
 *
 * **That sentence ended *"and `bin/seed.ts` cannot be told to close at all"* until 2026-08-06,
 * and the clause is corrected here rather than deleted** — this file's own established
 * practice for its two prior corrections, for the reason it gives at both of them: *a comment
 * asserting a mechanism is inert is the exact shape this repository has been bitten by; a
 * reader who believes it stops looking.* Plan 24-06 added `SeedServerOptions.relayAdmission`
 * and `bin/seed.ts --admit-issuer`, so the seed — the relay every browser tab in this fabric
 * reserves on, and the source of `BootstrapInfo.peerAddrs` — takes its posture from its
 * operator. **The default did not move**: that binary threads the flag through a ternary whose
 * absent arm is the open literal, so a seed told nothing is byte-identical to the seed before
 * the flag existed, and `reservation-exhaustion.node.test.ts` holds that behaviourally across
 * a real process. What criterion 8 still turns on is a reading over a *fabric* rather than
 * over one relay, and that reading is not this mechanism's to make.
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
 * **The two things that rests on were MEASUREMENTS not yet taken. Plan 24-03 took them,
 * and this paragraph carried the open wording for a wave after they were answered.** Both
 * are in `enrol-through-a-closed-door.node.test.ts`.
 *
 *   1. **A renewal IS a grant, so the window is bounded.** The joining side re-sends a
 *      `HopMessage.Type.RESERVE`; the relay handles it in the same `handleReserve` that
 *      calls `denyInboundRelayReservation`; and the server's store resets its
 *      `retimeableSignal` only on a grant it actually made, so a refused renewal never
 *      restarts the clock. Withdrawing admission from a peer already holding a reservation,
 *      changing nothing else, was observed re-consulting the gate and then dropping the peer:
 *      `ttlMs 40000 renewalAskedAfterMs 30027 droppedAfterMs 40028` (24-03), re-read
 *      independently by the verifier as `30031 / 40049` against the same 40 000 ms TTL. **The
 *      revocation window is the reservation TTL, as a number and not by construction alone.**
 *   2. **Shortening the TTL does not shorten the window below ~30 s.**
 *      `@libp2p/circuit-relay-v2`'s transport refreshes at
 *      `min(max(expiry - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)` with
 *      `REFRESH_TIMEOUT` 5 min and `REFRESH_TIMEOUT_MIN` **30 s** — read off the installed
 *      package, not off a comment — so for any TTL under five minutes the clamp wins, and
 *      below about 30 s a reservation expires before its holder ever tries to renew. That is
 *      churn, not revocation. It is a property of the installed package, not of this union.
 *
 * A third measurement belongs beside them because it decides what an operator can expect of
 * a refusal: **a refused peer never retries by itself.** libp2p arms its refresh timer only
 * inside the success path, so a failed reservation leaves no timer at all, and a
 * *reconnection* — not the passage of time — is what gets a newly-admitted peer in.
 *
 * What remains open is the composition question, and it is open as a measurement rather than
 * as a doubt: `expired` staying out of `PeerVerifier`'s `FINAL` set should mean a lapsed peer
 * fails at its next renewal rather than being cached as permanently refused, and the gate
 * re-decides from scratch at every grant instead of memoising, which is the behaviour that
 * would make it so.
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
 * A predicate rather than a comparison at each call site, so that there is one place that
 * decides what the union *means* and not one per reader.
 *
 * **It has exactly one production caller, and that is a pinned property rather than an
 * observation.** Plan 24-03 armed the gate and `fabric-node.ts`'s `relayAdmissionGate` opens
 * with it, returning `undefined` — no gater method at all — for the open posture.
 * `relay-admission.node.test.ts` asserts the caller set is exactly this file and
 * `fabric-node.ts`: a *second* production caller would be the single-place-decides guarantee
 * gone. The docblock here read **"Nothing calls this yet"** for a wave after that stopped
 * being true; it was corrected 2026-08-06.
 */
export function admitsAnyPeer(admission: RelayAdmission): boolean {
  return admission === ADMITS_ANY_PEER
}
