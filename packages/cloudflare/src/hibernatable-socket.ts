/**
 * The inbound socket held against the hibernation API — Phase 30, requirement 4.
 *
 * ## What §17 measured, stated narrowly
 *
 * `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §17 ran two idle
 * sockets on a deployed object:
 *
 * | acceptance | idle | outcome |
 * |---|---|---|
 * | `state.acceptWebSocket(server)` | 15 min | never closed |
 * | `server.accept()`, carrying libp2p | 6 min | connection `aborted` |
 *
 * **The proven win of this file is the six-minute abort, and nothing wider.** The consult's own
 * framing — *"an adapter is written against the hibernation API so an idle peer costs nothing"*
 * — does **not** follow from this adapter alone, and saying so here is cheaper than a later
 * correction: `@chainsafe/libp2p-yamux@8.0.1` defaults `enableKeepAlive: true` with
 * `keepAliveInterval: 30_000` (`dist/src/config.js:4-5`, read in this repository), so a live
 * libp2p connection sends a frame every thirty seconds and **every frame wakes the object.**
 * An object under a live connection will therefore not hibernate at all. Taming that keepalive
 * is a real decision and it is **not** taken here: a peer that never sends cannot detect a dead
 * path, so the trade is the owner's rather than this file's.
 *
 * ## Why a revived socket is CLOSED rather than resumed
 *
 * This is the design's whole difficulty and it has exactly one honest answer. When the object
 * is evicted, the platform reconstructs it and calls `webSocketMessage` on a **fresh
 * instance**. Everything in memory is gone — and for a libp2p connection that memory is the
 * Noise session and the yamux muxer state. Neither can be rebuilt: Noise in libp2p has no
 * session resumption, yamux has no resync, and `serializeAttachment`'s 2 KB could not carry
 * either if they did.
 *
 * So the alternatives to closing are all forms of lying. Buffering keeps a connection whose
 * peer believes a handshake is live when none is. Replaying is not possible without the keys.
 * Dropping the frame silently leaves the peer waiting forever on a socket the platform still
 * reports as open. **A prompt close with a named code turns an eviction from a mystery abort
 * into a defined redial signal**, which is the only outcome a peer can act on.
 *
 * ## What is proven here and what the first deploy still owns
 *
 * Proven locally: that the adopt path goes through `state.acceptWebSocket` and never
 * `socket.accept()`, that a frame for a live socket reaches the connection, and that a frame
 * for a socket this instance has never seen closes it instead of throwing or vanishing.
 *
 * Deploy-gated, and reported open rather than simulated: §17's own six-versus-fifteen minute
 * reading; whether workerd accepts {@link CLOSED_AFTER_HIBERNATION} as a close code (1011 is
 * known accepted, because `sendReset` already sends it); and whether `binaryType` may be
 * assigned on a hibernatable socket at all. That last one is deliberately NOT asserted either
 * way — the spike lesson that made `acceptWebSocket` set it on the real socket was measured on
 * the `addEventListener` path, and carrying a reading across acceptance paths is the class of
 * error this package has already corrected twice.
 */

import { CloudflareWebSocketConnection, remoteAddrFromRequest } from './websocket-connection.ts'
import type { CloudflareWebSocket, CloudflareWebSocketConnectionInit } from './websocket-connection.ts'
import type { MultiaddrConnection } from '@libp2p/interface'

/**
 * The close code sent to a peer whose connection did not survive an eviction.
 *
 * 1012 is "Service Restart", which is what happened from the peer's side: the service holding
 * its session was restarted underneath it. A peer reading this knows to redial rather than to
 * retry a stream on a session that no longer exists.
 */
export const CLOSED_AFTER_HIBERNATION = 1012

/** The reason string sent with {@link CLOSED_AFTER_HIBERNATION}, short enough for the frame. */
export const HIBERNATION_CLOSE_REASON = 'session did not survive hibernation — please redial'

/** 1011 — the code `sendReset` already uses, and the one workerd is known to accept. */
export const UPGRADE_FAILED = 1011

/** Why a socket was closed before it ever carried a stream. */
export const UPGRADE_FAILED_REASON = 'libp2p inbound upgrade did not complete'

/**
 * The slice of `DurableObjectState` the hibernation path uses.
 *
 * Two methods, following `durable-object-storage.d.ts`'s stated discipline: an interface
 * declared as narrowly as it is used is one a fixture can implement completely.
 */
export interface HibernationCapableState {
  /** Marks the socket hibernatable. **Mutually exclusive with `socket.accept()`.** */
  acceptWebSocket: (socket: CloudflareWebSocket) => void
  /** Every socket this object holds, including ones adopted before an eviction. */
  getWebSockets: () => readonly CloudflareWebSocket[]
}

/** What {@link HibernatableSockets.message} did with a frame. */
export type FrameOutcome = 'delivered' | 'closed-after-hibernation'

/**
 * The live connections this instance holds, keyed by the socket object itself.
 *
 * **Keyed by identity on purpose.** After an eviction the platform hands `webSocketMessage` a
 * socket object this instance has never seen, so the lookup misses — and the miss IS the
 * detection. Nothing has to record that a hibernation happened, because a registry that was
 * built in memory cannot survive one either, and a flag that could would be a second source of
 * truth able to disagree with the first.
 */
export class HibernatableSockets {
  readonly #live = new Map<CloudflareWebSocket, CloudflareWebSocketConnection>()

  /** How many connections this instance is holding. Zero on a freshly revived object. */
  get size(): number {
    return this.#live.size
  }

  /**
   * Accept an inbound socket through the hibernation API and hold its connection.
   *
   * **`state.acceptWebSocket` and never `socket.accept()`** — the two acceptance paths are
   * mutually exclusive per socket, and taking the second is exactly the configuration §17
   * measured being aborted at six minutes. No `addEventListener` either: an adopted socket's
   * frames arrive as `webSocketMessage` on the object, which is why {@link message} exists.
   */
  adopt(
    state: HibernationCapableState,
    socket: CloudflareWebSocket,
    init: Omit<CloudflareWebSocketConnectionInit, 'socket'>,
  ): CloudflareWebSocketConnection {
    state.acceptWebSocket(socket)
    const connection = new CloudflareWebSocketConnection({ ...init, socket })
    this.#live.set(socket, connection)
    return connection
  }

  /**
   * Route one frame, or close a socket whose session is gone.
   *
   * A text frame on a live connection is reset rather than ignored, matching `acceptWebSocket`
   * on the other path: ignoring leaves the peer waiting for a reply to something never read.
   */
  message(socket: CloudflareWebSocket, data: ArrayBuffer | string): FrameOutcome {
    const connection = this.#live.get(socket)
    if (connection === undefined) return this.#closeRevived(socket)
    if (typeof data === 'string') {
      connection.onRemoteReset()
      return 'delivered'
    }
    connection.onData(new Uint8Array(data))
    return 'delivered'
  }

  /** The peer closed. Unknown sockets are dropped silently — there is nothing left to tell. */
  close(socket: CloudflareWebSocket): FrameOutcome {
    const connection = this.#live.get(socket)
    if (connection === undefined) return 'closed-after-hibernation'
    connection.onRemoteCloseWrite()
    this.#live.delete(socket)
    return 'delivered'
  }

  /** The platform reported a socket error. */
  error(socket: CloudflareWebSocket, cause: Error): FrameOutcome {
    const connection = this.#live.get(socket)
    if (connection === undefined) return 'closed-after-hibernation'
    connection.onTransportClosed(cause)
    this.#live.delete(socket)
    return 'delivered'
  }

  /** Drop a socket without touching it, for a connection that never became one. */
  forget(socket: CloudflareWebSocket): void {
    this.#live.delete(socket)
  }

  /**
   * Close a socket this instance has no session for.
   *
   * Deliberately does not throw. A throw inside `webSocketMessage` is an unhandled rejection on
   * a platform-invoked entry point, which surfaces as an object error rather than as a closed
   * socket — the peer would go on waiting either way, and the operator would get a stack trace
   * for an event that is ordinary.
   */
  #closeRevived(socket: CloudflareWebSocket): FrameOutcome {
    socket.close(CLOSED_AFTER_HIBERNATION, HIBERNATION_CLOSE_REASON)
    return 'closed-after-hibernation'
  }
}

/** As much of {@link InboundUpgradeService} as the listener calls. */
export interface InboundUpgradeTarget {
  upgradeInbound: (connection: MultiaddrConnection, signal?: AbortSignal) => Promise<void>
}

/**
 * Shape narrowing for the registered upgrade service.
 *
 * `libp2p.services` is an index of whatever was registered, so the value is genuinely unknown
 * at this boundary — the same reasoning `relay-reservations.ts` states for the relay service,
 * and the same answer: narrow by SHAPE rather than assert, because an assertion here would be
 * a claim about a registration nobody checked. A node assembled without the service is a
 * configuration error rather than a type error, and this is where it becomes visible.
 */
export function isInboundUpgradeTarget(value: unknown): value is InboundUpgradeTarget {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { upgradeInbound?: unknown }).upgradeInbound === 'function'
  )
}

/** Thrown when the assembly registered no inbound-upgrade service — see the narrowing above. */
export class NoInboundUpgradeServiceError extends Error {
  override readonly name: string = 'NoInboundUpgradeServiceError'

  constructor() {
    super(
      'this node registered no inbound-upgrade service, so an accepted socket has nothing to ' +
        'hand its connection to — see `inboundUpgradeService` in hosted-libp2p.ts',
    )
  }
}

/** What {@link acceptInboundSocket} needs. */
export interface AcceptInboundInit {
  readonly sockets: HibernatableSockets
  readonly state: HibernationCapableState
  readonly socket: CloudflareWebSocket
  /** The upgrade request, read only for its `CF-Connecting-IP` header. */
  readonly request: Request
  readonly upgrade: InboundUpgradeTarget
  readonly log: CloudflareWebSocketConnectionInit['log']
}

/**
 * Adopt an inbound socket and start its libp2p upgrade — the whole listener, minus the platform.
 *
 * Everything Cloudflare-shaped is left to the caller: constructing the `WebSocketPair` and
 * returning a 101 with the client half are two lines that no local run can execute, and keeping
 * them out means the decisions can be read by a spec while the untestable remainder stays too
 * small to hide one.
 *
 * **The upgrade is deliberately NOT awaited**, and that is the same rule `acceptWebSocket`
 * records on the other acceptance path: no byte moves until the 101 response is returned, so
 * awaiting the upgrade before returning it deadlocks by construction — `@libp2p/websockets`'
 * own listener does not await it either.
 *
 * Not awaiting is what makes the rejection handler load-bearing rather than tidy. A floating
 * promise that rejects on this platform is an unhandled rejection inside a request the caller
 * has already answered, so the failure would surface as an object error with no connection
 * attached to it. Closing the socket instead tells the peer, which is the only party that can
 * do anything about a handshake that did not complete.
 */
export function acceptInboundSocket(init: AcceptInboundInit): CloudflareWebSocketConnection {
  // Requirement 2, and it REFUSES rather than defaulting — see `remoteAddrFromRequest`. The
  // refusal happens before the socket is adopted, so a request with no client address costs
  // nothing and holds nothing.
  const remoteAddr = remoteAddrFromRequest(init.request)
  const connection = init.sockets.adopt(init.state, init.socket, { remoteAddr, log: init.log })

  void init.upgrade.upgradeInbound(connection).catch(() => {
    init.socket.close(UPGRADE_FAILED, UPGRADE_FAILED_REASON)
    init.sockets.forget(init.socket)
  })

  return connection
}
