/**
 * The backbone relay — NET-03's server side, and the precondition for the browser
 * tier.
 *
 * A browser peer is not dialable by anything. It cannot bind a listening socket, so
 * the only way two tabs reach each other is for both to hold a reservation on a
 * publicly reachable Circuit Relay v2 peer, which then carries the WebRTC SDP
 * exchange. Once ICE completes the relay drops out of the data path entirely.
 *
 * That last point is what the tuning below is *for*. The defaults exist to stop a
 * relay being abused as a free proxy: 2 minutes and 128 KiB per relayed connection.
 * Those are correct for signalling and fatal for anything else — which is why the
 * architecture treats the relay as a signalling channel and fetches artifacts by
 * another route. Raising them here is about accommodating slow ICE on bad networks,
 * not about moving bulk data.
 *
 * Listens on WebSockets because that is one of only three things a browser can
 * dial. On a public host this pairs with AutoTLS to get a browser-dialable `wss://`
 * address with no certificate operations; locally, `ws://127.0.0.1` is dialable
 * from a `http://localhost` page without any TLS at all, which is what keeps the
 * test path honest without needing infrastructure.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import {
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
} from '@o2/libp2p'

export interface RelayNodeOptions {
  /**
   * Addresses to listen on.
   *
   * Must include a browser-dialable one — `/ws` or `/wss` — or the relay is
   * useless to the tier it exists to serve.
   */
  readonly listen?: readonly string[]
  /** Concurrent reservations to accept. Defaults to libp2p's 15. */
  readonly maxReservations?: number
  readonly reservationTtlMs?: number
  readonly durationLimitMs?: number
  readonly dataLimitBytes?: bigint
  /**
   * Simultaneous inbound handshakes to permit.
   *
   * Defaults to `max(libp2p's 10, maxReservations)`. This is not a knob to leave
   * alone: a burst of browser tabs all joining at once is the normal case, and the
   * default of ten silently drops the excess *during* the noise handshake. Raising
   * `maxReservations` without raising this makes the extra capacity unreachable.
   */
  readonly maxIncomingPendingConnections?: number
  /**
   * Inbound connections per second to accept from one host.
   *
   * Defaults to `max(libp2p's 5, maxReservations)` because libp2p's default of five
   * is far too low for this fabric: it is a *per-host* rate limit, so every peer
   * behind one NAT — or every tab in a local test — shares the budget. See
   * `LIBP2P_INBOUND_CONNECTION_THRESHOLD`.
   */
  readonly inboundConnectionThreshold?: number
}

/**
 * What the relay knows about its own capacity, by name rather than by symptom.
 *
 * Every field is read from the live reservation store. There is deliberately no
 * lifetime "granted total": `@libp2p/circuit-relay-v2@4.2.9` declares a
 * `relay:reservation` event in its type definitions but **never dispatches it** —
 * the name appears only in `.d.ts` files, and `CircuitRelayServer` emits nothing at
 * all. A counter built on it would silently read zero forever, which is the exact
 * failure mode NET-05 exists to eliminate. `relay.node.test.ts` pins that finding,
 * so if a later release starts emitting, the test tells us.
 */
export interface RelayCapacity {
  readonly granted: number
  readonly limit: number
  readonly remaining: number
  readonly atCapacity: boolean
}

interface RelayService {
  readonly reservations: { readonly size: number }
}

function hasReservations(value: unknown): value is RelayService {
  if (value === null || typeof value !== 'object') return false
  const candidate = (value as { reservations?: unknown }).reservations
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as { size?: unknown }).size === 'number'
  )
}

export class RelayNode {
  readonly libp2p: Libp2p
  readonly #limit: number
  readonly #pending: number
  readonly #inboundPerSecond: number

  private constructor(libp2p: Libp2p, limit: number, pending: number, inboundPerSecond: number) {
    this.libp2p = libp2p
    this.#limit = limit
    this.#pending = pending
    this.#inboundPerSecond = inboundPerSecond
  }

  /** Simultaneous inbound handshakes this relay will accept. */
  get maxIncomingPendingConnections(): number {
    return this.#pending
  }

  /** Inbound connections per second this relay accepts from one host. */
  get inboundConnectionThreshold(): number {
    return this.#inboundPerSecond
  }

  static async start(options: RelayNodeOptions = {}): Promise<RelayNode> {
    const limit = options.maxReservations ?? RELAY_MAX_RESERVATIONS
    // Coupled deliberately — see the option's documentation.
    const pending =
      options.maxIncomingPendingConnections ??
      Math.max(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS, limit)
    const inboundPerSecond =
      options.inboundConnectionThreshold ??
      Math.max(LIBP2P_INBOUND_CONNECTION_THRESHOLD, limit)

    const libp2p = await createLibp2p({
      addresses: {
        listen: [...(options.listen ?? ['/ip4/127.0.0.1/tcp/0/ws'])],
      },
      // Both, deliberately: `/ws` is what a browser can dial, plain TCP is what
      // other backbone nodes prefer.
      transports: [webSockets(), tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionManager: {
        maxIncomingPendingConnections: pending,
        // Per *host*, so a burst of tabs from one machine — or of volunteers behind
        // one NAT — would otherwise be rejected mid-handshake.
        inboundConnectionThreshold: inboundPerSecond,
      },
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        ping: ping(),
        relay: circuitRelayServer({
          reservations: {
            maxReservations: limit,
            reservationTtl: options.reservationTtlMs ?? RELAY_MAX_RESERVATION_TTL_MS,
            defaultDurationLimit: options.durationLimitMs ?? RELAY_DURATION_LIMIT_MS,
            defaultDataLimit: options.dataLimitBytes ?? RELAY_DATA_LIMIT_BYTES,
          },
        }),
      },
    })

    // The server dispatches no events whatsoever, so there is nothing to subscribe
    // to here — capacity is read from the reservation store on demand, and the
    // joining node's side is handled in `reservation-watch.ts`.
    return new RelayNode(libp2p, limit, pending, inboundPerSecond)
  }

  get peerId(): string {
    return this.libp2p.peerId.toString()
  }

  get multiaddrs(): readonly string[] {
    return this.libp2p.getMultiaddrs().map((ma) => ma.toString())
  }

  /** The browser-dialable subset. A browser cannot use anything else. */
  get browserDialableAddrs(): readonly string[] {
    return this.multiaddrs.filter((ma) => ma.includes('/ws') || ma.includes('/wss'))
  }

  /**
   * Current capacity, reported by name.
   *
   * NET-05: a relay at capacity must say so. Without this, a node that cannot
   * reserve sees only "no circuit address appeared", which is indistinguishable
   * from the relay being unreachable — and the two need completely different
   * responses (try another relay vs. wait and retry).
   */
  get capacity(): RelayCapacity {
    const service: unknown = this.libp2p.services['relay']
    const granted = hasReservations(service) ? service.reservations.size : 0
    return {
      granted,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - granted),
      atCapacity: granted >= this.#limit,
    }
  }

  async stop(): Promise<void> {
    await this.libp2p.stop()
  }
}
