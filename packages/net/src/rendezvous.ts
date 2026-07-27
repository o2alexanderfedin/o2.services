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
 * Pure module — the endpoint and the peer list arrive as parameters.
 */

import type { CanonicalValue } from '@o2/core'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

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
    for (const holder of response.peerIds) {
      // Never our own reservation coming back to us through the node holding it.
      if (holder === options.self) continue
      addrs.add(`/p2p/${peer}/p2p-circuit/webrtc/p2p/${holder}`)
    }
  }

  return { answered, addrs: [...addrs].sort() }
}
