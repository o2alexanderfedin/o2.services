/**
 * The hibernation path's three claims, and what none of them can reach.
 *
 * §17's own reading — six minutes against fifteen — was taken on a deployed object and cannot
 * be retaken here; no local emulator reproduces an eviction credibly, which is the same limit
 * `expiry-alarm.ts` records for its alarm. What IS local is the thing that reading depends on:
 * that this path takes `state.acceptWebSocket` and not `socket.accept()`. If it took the
 * second, §17 says what happens, and no amount of testing here would see it.
 *
 * The case that carries the file is the third describe. An evicted object is reconstructed and
 * handed a socket it has never seen, holding a session that no longer exists — and the only
 * honest answer is to close it, because Noise cannot resume and yamux cannot resync.
 */

import { defaultLogger } from '@libp2p/logger'
import { describe, expect, it, vi } from 'vitest'
import {
  CLOSED_AFTER_HIBERNATION,
  HIBERNATION_CLOSE_REASON,
  HibernatableSockets,
  UPGRADE_FAILED,
  UPGRADE_FAILED_REASON,
  acceptInboundSocket,
  isInboundUpgradeTarget,
} from './hibernatable-socket.ts'
import {
  CLIENT_ADDRESS_HEADER,
  MissingClientAddressError,
  remoteAddrFromRequest,
} from './websocket-connection.ts'
import type { CloudflareWebSocket } from './websocket-connection.ts'
import type { HibernationCapableState, InboundUpgradeTarget } from './hibernatable-socket.ts'
import type { MultiaddrConnection } from '@libp2p/interface'

/** A socket that records everything done to it. Complete against the declared interface. */
class FakeSocket implements CloudflareWebSocket {
  binaryType = 'blob'
  accepted = 0
  listeners = 0
  readonly sent: ArrayBuffer[] = []
  readonly closes: { code?: number | undefined; reason?: string | undefined }[] = []

  accept(): void {
    this.accepted += 1
  }

  send(data: ArrayBuffer): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason })
  }

  addEventListener(): void {
    this.listeners += 1
  }
}

/** The two-method slice of `DurableObjectState`, implemented completely. */
class FakeState implements HibernationCapableState {
  readonly adopted: CloudflareWebSocket[] = []

  acceptWebSocket(socket: CloudflareWebSocket): void {
    this.adopted.push(socket)
  }

  getWebSockets(): readonly CloudflareWebSocket[] {
    return this.adopted
  }
}

const REMOTE = remoteAddrFromRequest(
  new Request('https://example.invalid/', { headers: { [CLIENT_ADDRESS_HEADER]: '203.0.113.7' } }),
)

function adopted(): {
  readonly sockets: HibernatableSockets
  readonly state: FakeState
  readonly socket: FakeSocket
} {
  const sockets = new HibernatableSockets()
  const state = new FakeState()
  const socket = new FakeSocket()
  sockets.adopt(state, socket, { remoteAddr: REMOTE, log: defaultLogger().forComponent('test') })
  return { sockets, state, socket }
}

describe('the socket is adopted by the platform, not accepted by us', () => {
  it('goes through `state.acceptWebSocket` and NEVER `socket.accept()`', () => {
    // The local proxy for §17's six-versus-fifteen minutes, which cannot be retaken here. The
    // two acceptance paths are mutually exclusive per socket, and the second is precisely the
    // one measured being aborted at six minutes while the object stayed up. Plant that reddens
    // this: call `socket.accept()` in `adopt`.
    const { state, socket } = adopted()

    expect(state.adopted).toEqual([socket])
    expect(socket.accepted).toBe(0)
  })

  it('registers no event listeners, because frames arrive on the object instead', () => {
    // An adopted socket delivers to `webSocketMessage` on the Durable Object. A listener here
    // would be a second delivery path that works right up until the first eviction.
    expect(adopted().socket.listeners).toBe(0)
  })

  it('holds the connection, so a revived instance can be told apart by holding none', () => {
    const { sockets } = adopted()
    expect(sockets.size).toBe(1)
    expect(new HibernatableSockets().size).toBe(0)
  })
})

describe('frames reach the connection they belong to', () => {
  it('delivers a binary frame as bytes', async () => {
    // Read back through the connection's own stream surface rather than through a spy, so this
    // asserts the path libp2p actually takes. Plant that reddens this: drop the registry
    // lookup and always take the revived branch.
    const sockets = new HibernatableSockets()
    const state = new FakeState()
    const socket = new FakeSocket()
    const connection = sockets.adopt(state, socket, {
      remoteAddr: REMOTE,
      log: defaultLogger().forComponent('test'),
    })

    expect(sockets.message(socket, new Uint8Array([7, 8, 9]).buffer)).toBe('delivered')

    const first = await connection[Symbol.asyncIterator]().next()
    expect([...(first.value ?? new Uint8Array()).subarray()]).toEqual([7, 8, 9])
    expect(socket.closes).toEqual([])
  })

  it('resets on a text frame rather than ignoring it', () => {
    // Matches `acceptWebSocket` on the other path: ignoring leaves the peer waiting for a
    // reply to something that was never read.
    const { sockets, socket } = adopted()
    expect(sockets.message(socket, 'hello')).toBe('delivered')
    expect(sockets.size).toBe(1)
  })

  it('routes a close and an error to the connection, and forgets the socket', () => {
    const a = adopted()
    expect(a.sockets.close(a.socket)).toBe('delivered')
    expect(a.sockets.size).toBe(0)

    const b = adopted()
    expect(b.sockets.error(b.socket, new Error('transport gone'))).toBe('delivered')
    expect(b.sockets.size).toBe(0)
  })
})

describe('a socket that outlived its session is CLOSED, which is the whole design', () => {
  it('closes an unknown socket with the named code and throws nothing', () => {
    // The revival case, modelled the way the platform produces it: a fresh instance is handed
    // a socket it never adopted. Noise has no session resumption and yamux has no resync, so
    // there is no state to rebuild and every alternative to closing is a connection that lies
    // about being live. Plant that reddens this: throw instead, or return 'delivered' and drop
    // the frame.
    const revived = new HibernatableSockets()
    const survivor = new FakeSocket()

    expect(revived.message(survivor, new Uint8Array([1]).buffer)).toBe('closed-after-hibernation')
    expect(survivor.closes).toEqual([
      { code: CLOSED_AFTER_HIBERNATION, reason: HIBERNATION_CLOSE_REASON },
    ])
  })

  it('uses 1012 — "Service Restart", which is what happened from the peer’s side', () => {
    // Named rather than written at the call site, so a reader of the close frame and a reader
    // of this file see the same reason. Whether workerd accepts this exact code is
    // deploy-gated; 1011 is known accepted because `sendReset` already sends it.
    expect(CLOSED_AFTER_HIBERNATION).toBe(1012)
  })

  it('does not throw on a close or an error for a socket it never had', () => {
    // A throw inside a platform-invoked entry point is an object error, not a closed socket:
    // the peer waits either way and the operator gets a stack trace for something ordinary.
    const revived = new HibernatableSockets()
    expect(revived.close(new FakeSocket())).toBe('closed-after-hibernation')
    expect(revived.error(new FakeSocket(), new Error('x'))).toBe('closed-after-hibernation')
  })
})

describe('the listener — what it refuses, what it starts, and what it never awaits', () => {
  /** An upgrade target whose promise the case controls. */
  function upgrader(): {
    readonly target: InboundUpgradeTarget
    readonly calls: MultiaddrConnection[]
    settle: (err?: Error) => void
  } {
    const calls: MultiaddrConnection[] = []
    let settle: (err?: Error) => void = () => {}
    const target: InboundUpgradeTarget = {
      upgradeInbound: async (connection) => {
        calls.push(connection)
        return new Promise<void>((resolve, reject) => {
          settle = (err) => (err === undefined ? resolve() : reject(err))
        })
      },
    }
    return { target, calls, settle: (err) => settle(err) }
  }

  const upgradeRequest = (address: string | null): Request =>
    new Request(
      'https://example.invalid/',
      address === null ? {} : { headers: { [CLIENT_ADDRESS_HEADER]: address } },
    )

  it('REFUSES a request with no client address BEFORE adopting anything', () => {
    // Requirement 2 arriving at the listener. The ordering is the point: a refusal after the
    // adopt would leave a socket held by the platform with no session and nobody to close it.
    // Plant that reddens this: move `remoteAddrFromRequest` below the `adopt` call.
    const sockets = new HibernatableSockets()
    const state = new FakeState()
    const socket = new FakeSocket()

    expect(() =>
      acceptInboundSocket({
        sockets,
        state,
        socket,
        request: upgradeRequest(null),
        upgrade: upgrader().target,
        log: defaultLogger().forComponent('test'),
      }),
    ).toThrow(MissingClientAddressError)

    expect(state.adopted).toEqual([])
    expect(sockets.size).toBe(0)
  })

  it('starts the upgrade WITHOUT awaiting it, because awaiting deadlocks by construction', () => {
    // No byte moves until the 101 response is returned, so a listener that awaited the upgrade
    // before returning it would wait for traffic that its own return is the precondition of.
    // This case is synchronous on purpose: it returns while the upgrade promise is still
    // pending, which is exactly the property being asserted.
    const up = upgrader()
    const sockets = new HibernatableSockets()
    const socket = new FakeSocket()

    const connection = acceptInboundSocket({
      sockets,
      state: new FakeState(),
      socket,
      request: upgradeRequest('203.0.113.9'),
      upgrade: up.target,
      log: defaultLogger().forComponent('test'),
    })

    expect(up.calls).toEqual([connection])
    expect(sockets.size).toBe(1)
    expect(socket.closes).toEqual([])
  })

  it('carries the CLIENT address into the connection, not the edge’s', () => {
    // Criterion 3 as far as a local run reaches it: the same value for every peer is the
    // failure this exists to catch, so the address is read back off the connection itself.
    const connection = acceptInboundSocket({
      sockets: new HibernatableSockets(),
      state: new FakeState(),
      socket: new FakeSocket(),
      request: upgradeRequest('198.51.100.4'),
      upgrade: upgrader().target,
      log: defaultLogger().forComponent('test'),
    })

    expect(connection.remoteAddr.toString()).toBe('/ip4/198.51.100.4/tcp/443/tls/ws')
  })

  it('CLOSES the socket when the upgrade fails, rather than leaving a floating rejection', async () => {
    // The handler is load-bearing, not tidy: the request has already been answered by the time
    // this can reject, so an uncaught rejection is an object error with no connection attached
    // and a peer left holding an open socket that will never carry a stream. Plant that
    // reddens this: drop the `.catch`.
    const up = upgrader()
    const sockets = new HibernatableSockets()
    const socket = new FakeSocket()
    acceptInboundSocket({
      sockets,
      state: new FakeState(),
      socket,
      request: upgradeRequest('203.0.113.9'),
      upgrade: up.target,
      log: defaultLogger().forComponent('test'),
    })

    up.settle(new Error('noise handshake refused'))

    // `waitFor` rather than a fixed number of microtask ticks: the rejection travels through an
    // async function's own promise before it reaches the `.catch`, and counting the hops would
    // be asserting today's transpilation rather than the behaviour.
    await vi.waitFor(() => {
      expect(socket.closes).toEqual([{ code: UPGRADE_FAILED, reason: UPGRADE_FAILED_REASON }])
    })
    expect(sockets.size).toBe(0)
  })
})

describe('the upgrade service is narrowed by shape, not asserted', () => {
  it('accepts a registered service', () => {
    expect(isInboundUpgradeTarget({ upgradeInbound: async () => {} })).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined — a node assembled without the service', undefined],
    ['a string', 'inbound'],
    ['an object with no upgradeInbound', { upgrade: () => {} }],
    ['upgradeInbound that is not a function', { upgradeInbound: true }],
  ])('refuses %s', (_name, value) => {
    // `libp2p.services` is an index of whatever was registered, so this value is genuinely
    // unknown here. An assertion would be a claim about a registration nobody checked, and a
    // node assembled without the service would then fail somewhere with no name attached.
    expect(isInboundUpgradeTarget(value)).toBe(false)
  })
})
