/**
 * Finding the other browsers — NET-03, and what the static tier cannot do without.
 *
 * A browser binds no listening socket. That is the *only* difference between nodes
 * in this fabric, and it has one consequence that will not go away: no tab can be
 * dialled cold, and none of them will ever announce itself. Two browsers reserved
 * on the same node stay invisible to each other for as long as nobody says who is
 * present.
 *
 * The node holding their reservations already knows, as a consequence of doing its
 * job. So the rendezvous is one request over the fabric's own protocol.
 *
 * ## Why not the HTTP endpoint that already works
 *
 * A seed node serves `/bootstrap.json` from the origin that served the page, and on
 * a LAN that is the better answer — it needs no node started and no consent yet. But
 * a static host has no origin to ask and DEMO-03 forbids adding a server-side
 * process, so on that tier the HTTP route does not exist at all. Asking a peer
 * instead works on both, and needs nothing the fabric does not already have.
 *
 * ## What this deliberately does not do
 *
 * It does not ask whether a peer *is* a relay. There is no such question: a node
 * relaying for nobody and a node that cannot relay both answer with an empty list,
 * and no field distinguishes them, because a field would be a kind to branch on.
 *
 * ## Both halves live here, and that is the fix of 2026-08-31
 *
 * Until then this file held only the asking half, and the answering half existed once — as a
 * branch of `serveAgent` (`agent.ts:1194`). That is fine for a node that runs tasks and wrong
 * for one that only relays: `AgentOptions` requires an `executor` and a `blockstore` with no
 * named opt-out, so the deployed hosted relay could not answer this question without also
 * shipping a WASM executor it has no phase for. It therefore answered nothing at all, and two
 * tabs reserved on it stayed invisible to each other — the exact failure the header above
 * describes, reintroduced by the one tier built to prevent it.
 *
 * {@link serveReservations} is that branch with nothing else attached. `serveAgent` keeps its
 * own copy rather than delegating, because the two differ in what they do with every OTHER
 * request kind and merging them would make one of the two answers a special case of the
 * other's options object.
 *
 * Pure module — the endpoint and the peer list arrive as parameters.
 */

import type { CanonicalValue } from '@o2/core'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import type { RpcEndpoint, RpcHandler } from './rpc.ts'

/**
 * Holders one answering peer may name.
 *
 * A bound on a hostile answer, and it costs no truthful one at any tier's default:
 * `FabricNode` (`fabric-node.ts:1953`), `SeedServer` (`seed-server.ts:464`) and the
 * hosted relay (`hosted-libp2p.ts`'s `hostedRelayInit`) all resolve to
 * `O2_MAX_RESERVATIONS`, which is 64. What it does cost is the tail of a relay
 * configured **above** 64 — which `O2_MAX_RESERVATIONS`'s own docblock invites, having
 * measured 256 of 256 granted — and that relay's extra holders are invisible from *this*
 * peer's view. This constant is the line to change with it.
 *
 * **CORRECTED 2026-08-31.** This read *"libp2p's default reservation store is 15
 * (`RELAY_MAX_RESERVATIONS`), `FabricNode` takes that default, and `SeedServer` raises it
 * to 64 (`seed-server.ts:222`) — the largest store any node here is configured for."*
 * Three errors: `fabric-node.ts:1953` is `options.maxReservations ?? O2_MAX_RESERVATIONS`
 * and takes no library default, the seed's line is `:464`, and a third tier now relays.
 * The conclusion the sentence supported survives; the reasons it gave did not.
 */
export const MAX_RESERVED_PEERS_PER_ANSWER = 64

export interface RendezvousOptions {
  readonly rpc: RpcEndpoint
  /** Peers to ask. A thunk so a peer that connected a moment ago is included. */
  readonly peers: () => readonly string[]
  /** This node's own id, so it is not offered its own address to dial. */
  readonly self: string
}

export interface Rendezvous {
  /** Peers asked that answered at all. Zero means the fabric told us nothing. */
  readonly answered: number
  /**
   * Dialable addresses for peers reserved elsewhere, self excluded.
   *
   * A reservation is held *on* a node, so the address that reaches its holder goes
   * through that node: `<peer>/p2p-circuit/webrtc/p2p/<holder>`. The address is
   * therefore only meaningful relative to the peer that reported it, which is why
   * it is built here rather than returned raw by the protocol.
   */
  readonly addrs: readonly string[]
}

/**
 * Ask every connected peer who else is reserved on them.
 *
 * Answers are merged rather than taken from the first responder: two relays hold
 * different populations, and stopping at the first would silently halve a fabric
 * spread across two of them.
 */
export async function findReservedPeers(options: RendezvousOptions): Promise<Rendezvous> {
  const addrs = new Set<string>()
  let answered = 0

  for (const peer of options.peers()) {
    let body: CanonicalValue
    try {
      body = await options.rpc.request(peer, encodeRequest({ kind: 'reservations' }))
    } catch {
      continue // unreachable, or a peer that does not speak the protocol
    }
    const response = parseResponse(body)
    if (response === null || response.kind !== 'reservations') continue
    answered += 1
    let taken = 0
    for (const holder of response.peerIds) {
      // Never our own reservation coming back to us through the node holding it.
      // Before the count, so an echo of our own id costs no slot.
      if (holder === options.self) continue
      if (taken >= MAX_RESERVED_PEERS_PER_ANSWER) break
      taken += 1
      addrs.add(`/p2p/${peer}/p2p-circuit/webrtc/p2p/${holder}`)
    }
  }

  return { answered, addrs: [...addrs].sort() }
}

/**
 * Answer `{kind:'reservations'}`, and refuse every other request kind by name.
 *
 * The whole serving surface of a node that relays and does nothing else. Install it with
 * `RpcEndpoint.serve` on a tier that must be findable through but must not be asked to
 * compute — which today is the hosted relay, and tomorrow is any node deployed the same way.
 *
 * ## Refusing by name rather than by silence
 *
 * An unknown kind gets `{kind:'error'}` carrying the kind it refused, not a dropped frame.
 * Silence and refusal are the distinction NET-10 exists to remove, and a requestor that
 * cannot tell "this node does not compute" from "this node did not answer" retries a peer
 * that will never say yes. The reason names the kind so the reading is actionable rather
 * than only legible.
 *
 * ## `'relays-for-nobody'` is a posture, not an emptiness
 *
 * Spelled the same way `AgentOptions.reservations` spells it, and for `protocol.ts:262-266`'s
 * reason: a relay with no guests and a node that cannot relay must produce the same `[]`, so
 * that the wire carries no capability flag for a caller to branch on. The named literal is
 * how a deployment states which one it is *to a reader of the code*, while the wire stays
 * unable to tell.
 *
 * ## No cap here
 *
 * {@link MAX_RESERVED_PEERS_PER_ANSWER} bounds what a *reader* accepts from an answering
 * peer, and that is where a bound against a hostile answer belongs. Capping here as well
 * would bound this node's honesty about its own store, which is not the same property and
 * not one worth having.
 */
export function serveReservations(
  reservations: (() => readonly string[]) | 'relays-for-nobody',
): RpcHandler {
  return async (_from: string, body: CanonicalValue): Promise<CanonicalValue> => {
    const request = parseRequest(body)
    if (request === null) {
      return encodeResponse({ kind: 'error', reason: 'malformed request' })
    }
    if (request.kind !== 'reservations') {
      return encodeResponse({
        kind: 'error',
        reason: `this node serves reservations only, not ${request.kind}`,
      })
    }
    return encodeResponse({
      kind: 'reservations',
      peerIds: reservations === 'relays-for-nobody' ? [] : [...reservations()],
    })
  }
}
