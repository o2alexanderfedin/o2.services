/**
 * The inbound listener's four requirements, each asserted against the failure it prevents.
 *
 * Every case below exists because omitting the thing it checks fails **quietly** — a dial that
 * completes and then carries nothing, a node that throttles the world, a socket that refuses
 * every frame. None of them announces itself, which is why each is measured here rather than
 * left to a deployed run to discover.
 */

import { defaultLogger } from '@libp2p/logger'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_ADDRESS_HEADER,
  CloudflareWebSocketConnection,
  MissingClientAddressError,
  acceptWebSocket,
  remoteAddrFromRequest,
} from './websocket-connection.ts'
import type { CloudflareWebSocket } from './websocket-connection.ts'

/**
 * A **complete** implementation of {@link CloudflareWebSocket} — every member has real
 * behaviour and nothing is a stub returning a fixed value.
 *
 * Complete is possible only because the interface was declared as narrowly as the adapter
 * actually uses it, and it is what lets these cases claim to model the platform. The same
 * argument `do-storage.fixture.ts` makes for its own fake.
 *
 * It records rather than asserts: what was sent, in what order, and what close code arrived,
 * so a case reads the calls the adapter made instead of its own expectations.
 */
class FakeCloudflareWebSocket implements CloudflareWebSocket {
  binaryType = 'blob'
  accepted = 0
  /** `binaryType` as it stood at the moment `accept()` was called — see the ordering case. */
  binaryTypeAtAccept: string | null = null
  readonly sent: ArrayBuffer[] = []
  readonly closes: { code?: number | undefined; reason?: string | undefined }[] = []
  readonly #listeners = new Map<string, (event: unknown) => void>()

  accept(): void {
    this.accepted += 1
    this.binaryTypeAtAccept = this.binaryType
  }

  send(data: ArrayBuffer): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason })
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.set(type, listener)
  }

  /** Deliver a frame the way the platform would. */
  emit(type: string, event: unknown): void {
    this.#listeners.get(type)?.(event)
  }
}

function connect(socket: FakeCloudflareWebSocket = new FakeCloudflareWebSocket()): {
  readonly socket: FakeCloudflareWebSocket
  readonly connection: CloudflareWebSocketConnection
} {
  const connection = acceptWebSocket(socket, {
    remoteAddr: remoteAddrFromRequest(
      new Request('https://example.invalid/', { headers: { [CLIENT_ADDRESS_HEADER]: '203.0.113.7' } }),
    ),
    log: defaultLogger().forComponent('test'),
  })
  return { socket, connection }
}

describe('requirement 1 — direction is inbound, and it cannot be forgotten', () => {
  it('reports inbound, which is what stops both ends negotiating yamux as clients', () => {
    // Omitted, this defaults to outbound and EVERY STREAM is refused with `Both endpoints are
    // clients` — while the dial succeeds and Noise completes, so it reads as a deep protocol
    // bug rather than one missing field (consult §14).
    const { connection } = connect()
    expect(connection.direction).toBe('inbound')
  })

  it('takes no `direction` from its caller at all', () => {
    // The stronger half: the field is fixed by the constructor, so there is no argument a
    // caller could get wrong. `Omit<…, 'direction'>` is what says so in the type, and this
    // reads it back off a constructed object so the claim is not only a declaration.
    const socket = new FakeCloudflareWebSocket()
    const built = new CloudflareWebSocketConnection({
      socket,
      remoteAddr: remoteAddrFromRequest(
        new Request('https://example.invalid/', { headers: { [CLIENT_ADDRESS_HEADER]: '198.51.100.4' } }),
      ),
      log: defaultLogger().forComponent('test'),
    })
    expect(built.direction).toBe('inbound')
  })
})

describe('requirement 2 — the remote address is the real client, or nothing', () => {
  it('derives an ip4 multiaddr from the header Cloudflare sets', () => {
    const addr = remoteAddrFromRequest(
      new Request('https://example.invalid/', { headers: { [CLIENT_ADDRESS_HEADER]: '203.0.113.7' } }),
    )
    expect(addr.toString()).toBe('/ip4/203.0.113.7/tcp/443/tls/ws')
  })

  it('derives an ip6 multiaddr, so the protocol matches the address rather than being assumed', () => {
    const addr = remoteAddrFromRequest(
      new Request('https://example.invalid/', { headers: { [CLIENT_ADDRESS_HEADER]: '2001:db8::1' } }),
    )
    expect(addr.toString()).toBe('/ip6/2001:db8::1/tcp/443/tls/ws')
  })

  it('REFUSES a request with no client address instead of defaulting to loopback', () => {
    // This is the case that carries the requirement. A loopback fallback makes every inbound
    // connection report as the same host, and libp2p's INBOUND_CONNECTION_THRESHOLD — five per
    // second, PER HOST — then rate-limits the entire internet. The consult calls it "the most
    // consequential defect found in the listener", and it is invisible below six connections a
    // second, which is a scale nothing in development reaches.
    expect(() => remoteAddrFromRequest(new Request('https://example.invalid/'))).toThrow(
      MissingClientAddressError,
    )
  })
})

describe('requirement 3 — the answer taken for absent backpressure, stated as a reading', () => {
  it('reports every byte sent and always room for more', () => {
    const { socket, connection } = connect()
    // Through `send`, the stream's own public surface, rather than by calling the abstract
    // `sendData` directly: that is the path libp2p takes, and it is the one that proves the
    // queue reaches the socket at all. `send` returns whether more can be written, which is
    // requirement 3's answer arriving where a caller would actually read it.
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    expect(connection.send(payload)).toBe(true)

    expect(socket.sent).toHaveLength(1)
    expect([...new Uint8Array(socket.sent[0] as ArrayBuffer)]).toEqual([1, 2, 3, 4, 5])
  })

  it('hands the socket a COPY, not the caller’s view', () => {
    // `send` is asynchronous from this frame's point of view, so a view handed straight through
    // would carry whatever the caller wrote into it next. Mutating after the call is what makes
    // that observable — a missing copy passes every other case in this file.
    const { socket, connection } = connect()
    const payload = new Uint8Array([9, 9, 9])
    connection.send(payload)
    payload.set([0, 0, 0])

    expect([...new Uint8Array(socket.sent[0] as ArrayBuffer)]).toEqual([9, 9, 9])
  })
})

describe('the socket wiring — binary type, frames, and closes', () => {
  it('sets `arraybuffer` on the REAL socket BEFORE accepting it', () => {
    // The spike's recorded mistake: an adapter that reported `arraybuffer` through a Proxy while
    // the underlying socket was untouched made libp2p refuse every frame with `Incorrect binary
    // type`. The ordering is asserted too — a `binaryType` set after `accept()` is a different
    // program, and the fixture records the value as it stood at that instant rather than now.
    const { socket } = connect()
    expect(socket.accepted).toBe(1)
    expect(socket.binaryType).toBe('arraybuffer')
    expect(socket.binaryTypeAtAccept).toBe('arraybuffer')
  })

  it('delivers an ArrayBuffer frame as a `message` event, which is what libp2p listens for', async () => {
    const { socket, connection } = connect()
    const arrived: number[][] = []
    connection.addEventListener('message', (event) => {
      arrived.push([...event.data.subarray()])
    })

    socket.emit('message', { data: new Uint8Array([7, 7]).buffer })
    // The base class dispatches its read buffer on a microtask, so the assertion waits for one
    // rather than for a duration — a timing bound here would be a reading of the machine.
    await Promise.resolve()

    expect(arrived).toEqual([[7, 7]])
  })

  it('resets on a text frame rather than ignoring it', () => {
    // Ignoring would leave the peer waiting for a reply to something that was never read, which
    // is the quiet failure; a reset is the loud one.
    const { socket, connection } = connect()
    socket.emit('message', { data: 'not a libp2p frame' })
    expect(connection.status).not.toBe('open')
  })

  it('closes with 1000 on a normal close and 1011 on a reset', async () => {
    const { socket, connection } = connect()
    await connection.sendClose()
    expect(socket.closes).toEqual([{ code: 1000, reason: undefined }])

    const other = connect()
    other.connection.sendReset(new Error('gone'))
    expect(other.socket.closes[0]?.code).toBe(1011)
    expect(other.socket.closes[0]?.reason).toBe('gone')
  })
})
