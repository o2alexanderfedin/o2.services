/**
 * A Cloudflare WebSocket as a libp2p `MultiaddrConnection` — the inbound half of the hosted
 * tier, written here rather than borrowed.
 *
 * ## Why this is written and not imported
 *
 * `@libp2p/websockets` ships `webSocketToMaConn()`, which does this job, and the 2026-08-24
 * consult's §9 recipe names it. **It is not part of that package's public surface**: its
 * `exports` map declares `.` and `./filters`, and the barrel exports exactly one symbol,
 * `webSockets`. Reaching it means a path into `dist/`, which is a build artefact that can be
 * rearranged in any patch release with no semver signal — and
 * `.planning/consults/2026-08-25-noise-diffiehellman-on-workerd-measured.md` §4 records what
 * silent breakage in that neighbourhood looks like: a specifier that collided across the whole
 * dependency graph at build exit 0, with the victim absent from the sourcemap.
 *
 * **So the base class is imported through a public entry point and the platform-specific half
 * is written here.** `AbstractMultiaddrConnection` is re-exported by `@libp2p/utils`' own
 * barrel, so nothing below reaches past a package boundary. What is ours is exactly the part
 * that is about Cloudflare, and it is about forty lines.
 *
 * ## The four requirements, each with a measured silent-failure mode
 *
 * `.planning/research/v2.0/ARCHITECTURE.md:484-506` names four things this must get right, and
 * each one fails *quietly* when omitted — which is why they are stated here beside the code
 * that satisfies them rather than left in a document:
 *
 * 1. **`direction` must be `'inbound'`** (consult §14). Omitted, it defaults to outbound, both
 *    ends negotiate yamux as clients, and every stream is refused with `Both endpoints are
 *    clients` — while the dial succeeds and Noise completes, so it reads as a deep protocol
 *    bug rather than one missing field. It is a REQUIRED constructor argument here, not a
 *    defaulted option, so it cannot be forgotten.
 * 2. **`remoteAddr` must come from `CF-Connecting-IP`** (consult §19, *"the most consequential
 *    defect found in the listener"*). Without it every inbound connection reports as
 *    `127.0.0.1`, and libp2p's `INBOUND_CONNECTION_THRESHOLD` — five connections per second,
 *    **per host** — rate-limits the entire internet as one host. Invisible at small scale.
 *    {@link remoteAddrFromRequest} derives it and refuses rather than guessing.
 * 3. **`bufferedAmount` is ABSENT from workerd's WebSocket** (consult §16), not merely unset.
 *    See {@link CloudflareWebSocketConnection.sendData} for the answer taken and why it is a
 *    deliberate choice rather than an oversight.
 * 4. **Hibernation** (consult §17) — a plain `accept()` socket carrying libp2p died after six
 *    minutes idle while the object stayed up; a hibernatable socket survived fifteen minutes.
 *    **This class is the non-hibernating one**, and that is a scope statement rather than a
 *    limitation discovered later: `ARCHITECTURE.md:506` scopes the hibernation-aware adapter as
 *    its own task, and Phase 30 owns it. Nothing here should be read as covering it.
 */

import { AbstractMultiaddrConnection } from '@libp2p/utils'
import type { AbstractMultiaddrConnectionInit, SendResult } from '@libp2p/utils'
import { multiaddr } from '@multiformats/multiaddr'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { AbortOptions } from '@libp2p/interface'

/**
 * The byte-list type the base class declares, taken FROM the base class.
 *
 * Not `import type { Uint8ArrayList } from 'uint8arraylist'`, which was tried and fails to
 * compile: the root has `uint8arraylist@2.4.9` hoisted while `@libp2p/utils@7.3.0` resolves
 * `3.x`, and `CLAUDE.md`'s compatibility table names exactly this — *"v5/v2 respectively will
 * produce type mismatches at stream boundaries."* Deriving from the signature binds this to
 * whichever copy the base class actually uses, so the two cannot disagree, and it holds if the
 * dependency is realigned later.
 */
type SendableBytes = Parameters<AbstractMultiaddrConnection['sendData']>[0]

/**
 * The WebSocket surface this adapter uses, declared as narrowly as it uses it.
 *
 * The same discipline `durable-object-storage.d.ts` states for its own declaration: an
 * interface declared this narrowly is one a fixture can implement **completely**, and only a
 * complete fake can honestly claim to model the platform. `@cloudflare/workers-types` is
 * deliberately not a dependency.
 *
 * **`bufferedAmount` is absent from this declaration on purpose**, and that absence is the
 * measurement rather than an omission — see requirement 3 in the module note.
 */
export interface CloudflareWebSocket {
  /** Must be set to `'arraybuffer'` on the REAL socket — see {@link acceptWebSocket}. */
  binaryType: string
  accept: () => void
  send: (data: ArrayBuffer) => void
  close: (code?: number, reason?: string) => void
  addEventListener: (type: string, listener: (event: unknown) => void) => void
}

/** The header Cloudflare puts the real client address in. */
export const CLIENT_ADDRESS_HEADER = 'CF-Connecting-IP'

/** Thrown when a request carries no client address, rather than defaulting to loopback. */
export class MissingClientAddressError extends Error {
  constructor() {
    super(
      `no ${CLIENT_ADDRESS_HEADER} header on the request — refusing to invent a remote address, ` +
        'because a loopback default makes libp2p rate-limit the entire internet as one host',
    )
    this.name = 'MissingClientAddressError'
  }
}

/**
 * The remote multiaddr for an inbound request — requirement 2.
 *
 * **It throws rather than falling back.** A fallback is what produces the measured defect: a
 * loopback address on every connection, one host as far as libp2p's per-host inbound threshold
 * can tell, and a node silently capped at five connections a second no matter how many distinct
 * volunteers arrive. A refusal is loud at the first connection; the fallback is invisible until
 * the sixth volunteer of that second, which is a scale nothing in development reaches.
 *
 * IPv6 is detected by the colon that IPv4 cannot contain, so the multiaddr protocol matches the
 * address rather than being assumed.
 */
export function remoteAddrFromRequest(request: Request): Multiaddr {
  const client = request.headers.get(CLIENT_ADDRESS_HEADER)
  if (client === null || client.length === 0) throw new MissingClientAddressError()
  return multiaddr(`/${client.includes(':') ? 'ip6' : 'ip4'}/${client}/tcp/443/tls/ws`)
}

/** What {@link CloudflareWebSocketConnection} needs beyond the socket itself. */
export interface CloudflareWebSocketConnectionInit
  extends Omit<AbstractMultiaddrConnectionInit, 'direction'> {
  readonly socket: CloudflareWebSocket
}

/**
 * One inbound WebSocket, as a `MultiaddrConnection` libp2p's upgrader accepts.
 *
 * `direction` is fixed to `'inbound'` by construction rather than passed — requirement 1. This
 * class exists only on the receiving side of a Cloudflare edge, so an outbound one would be a
 * value nothing could produce correctly, and a field that can only hold one value is better
 * held by the type than by a caller's discipline.
 */
export class CloudflareWebSocketConnection extends AbstractMultiaddrConnection {
  readonly #socket: CloudflareWebSocket

  constructor(init: CloudflareWebSocketConnectionInit) {
    super({ ...init, direction: 'inbound' })
    this.#socket = init.socket
  }

  /**
   * Hand bytes to the socket.
   *
   * **`canSendMore` is unconditionally `true`, and that is requirement 3's answer taken
   * deliberately.** workerd's WebSocket has no `bufferedAmount` — measured absent from the
   * prototype (consult §16), not merely unset — so there is no reading from which backpressure
   * could be computed. The two available answers are `true`, which disables libp2p's
   * backpressure for this connection, and `false`, which would stall every write behind a drain
   * that never arrives. `true` is the only one that carries traffic, and the cost is stated
   * rather than hidden: **this connection applies no backpressure.** It is acceptable for the
   * signalling and control traffic this tier is for, and it is not acceptable for bulk data —
   * which the browser mesh cannot carry either, per `CLAUDE.md`'s WebRTC constraint.
   *
   * A fabricated `bufferedAmount` was tried in the spike and is recorded as the wrong answer:
   * an adapter that lied about a socket field through a Proxy made libp2p refuse every frame
   * with `Incorrect binary type`, and the consult records the diagnosis in the author's own
   * words — *"the lie was mine, not the platform's"*.
   */
  sendData(data: SendableBytes): SendResult {
    const bytes = data.subarray()
    // A copy into a plain buffer, not the list's view: `send` is asynchronous from this frame's
    // point of view and the caller may reuse the list, which would send whatever it holds next.
    const out = new Uint8Array(bytes.byteLength)
    out.set(bytes)
    this.#socket.send(out.buffer)
    return { sentBytes: bytes.byteLength, canSendMore: true }
  }

  /** 1011 — the WebSocket code for "an unexpected condition prevented completion". */
  sendReset(err: Error): void {
    this.#socket.close(1011, err.message.slice(0, 120))
  }

  /**
   * Both are no-ops, and the reason is the platform rather than an omission.
   *
   * Flow control on this connection would have to be expressed to the peer, and a raw WebSocket
   * has no frame for it — libp2p's own pause/resume is a muxer-level facility that runs ABOVE
   * this object. Throwing would be wrong (the base class calls these on ordinary backpressure
   * paths) and buffering would be a second, invisible queue in a class whose whole claim is
   * that it does not have one.
   */
  sendPause(): void {}

  sendResume(): void {}

  /** 1000 — a normal closure. */
  async sendClose(_options?: AbortOptions): Promise<void> {
    this.#socket.close(1000)
  }
}

/**
 * Accept an inbound socket and wire it to a connection — the whole listener, in one call.
 *
 * **`binaryType` is set on the REAL socket before `accept()`**, which is the second thing the
 * spike got wrong and recorded. An adapter that reported `'arraybuffer'` through a Proxy while
 * the underlying socket was left alone made libp2p refuse every frame with `Incorrect binary
 * type`. Cloudflare accepts the assignment and then delivers genuine `ArrayBuffer` frames; the
 * platform was never the problem.
 *
 * **What this deliberately does NOT do is call the upgrader.** `upgradeInbound` must not be
 * awaited before the 101 response is returned — no byte moves until the response is sent, so
 * awaiting deadlocks by construction, and `@libp2p/websockets`' own listener does not await it
 * either. Keeping the upgrade at the caller is what makes that ordering the caller's visible
 * decision instead of a rule buried in here.
 */
export function acceptWebSocket(
  socket: CloudflareWebSocket,
  init: Omit<CloudflareWebSocketConnectionInit, 'socket'>,
): CloudflareWebSocketConnection {
  socket.binaryType = 'arraybuffer'
  socket.accept()
  const connection = new CloudflareWebSocketConnection({ ...init, socket })

  socket.addEventListener('message', (event: unknown) => {
    const data = (event as { readonly data?: unknown }).data
    if (data instanceof ArrayBuffer) {
      connection.onData(new Uint8Array(data))
      return
    }
    // A text frame on a libp2p connection is not a protocol this node speaks. Resetting is
    // louder than ignoring, and ignoring would leave the peer waiting for a reply to something
    // that was never read.
    connection.onRemoteReset()
  })
  socket.addEventListener('close', () => {
    connection.onRemoteCloseWrite()
  })
  socket.addEventListener('error', () => {
    connection.onTransportClosed(new Error('the inbound WebSocket reported an error'))
  })

  return connection
}
