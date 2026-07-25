import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
} from '@o2/libp2p'
import { RelayNode } from './relay-node.ts'
import {
  RESERVATION_FAILURE_PREFIX,
  ReservationWatcher,
  STATUS_RESERVATION_REFUSED,
  classifyReservationFailure,
} from './reservation-watch.ts'

/**
 * NET-03 / NET-05 — the backbone relay, and exhaustion reported by name.
 */

const started: { stop(): void | Promise<void> }[] = []

/**
 * A peer that wants a relay reservation.
 *
 * `/p2p-circuit` in the listen list is what makes libp2p attempt a reservation on
 * any relay it connects to. WebSockets is the dial transport because that is what
 * the relay listens on — and what a browser would use.
 */
async function startReservingPeer(watcher?: ReservationWatcher): Promise<Libp2p> {
  const node = await createLibp2p({
    addresses: { listen: ['/p2p-circuit'] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    ...(watcher === undefined ? {} : { logger: watcher.logger }),
  })
  started.push(node)
  return node
}

/** Wait until `predicate` holds, or fail after `timeoutMs`. */
async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

afterEach(async () => {
  await Promise.all(started.splice(0).map(async (n) => {
    try {
      await n.stop()
    } catch {
      // A node that already failed to start is not worth failing teardown over.
    }
  }))
})

describe('NET-03 — the relay presents a browser-dialable address', () => {
  it('listens on WebSockets, which is one of the three things a browser can dial', async () => {
    const relay = await RelayNode.start()
    started.push(relay)

    expect(relay.multiaddrs.length).toBeGreaterThan(0)
    // A relay with no browser-dialable address cannot serve the tier it exists for.
    expect(relay.browserDialableAddrs.length).toBeGreaterThan(0)
    for (const address of relay.browserDialableAddrs) {
      expect(address).toContain('/ws')
      expect(address).toContain(`/p2p/${relay.peerId}`)
    }
  }, 30_000)

  it('contains no /certhash/ literal, so an address is not frozen into source', async () => {
    // Criterion 2's testable half. A hardcoded certhash expires with the
    // certificate, so a demo recorded today stops joining a fortnight later.
    // Addresses must be produced at runtime, as they are here.
    const relay = await RelayNode.start()
    started.push(relay)
    for (const address of relay.multiaddrs) {
      expect(address).not.toContain('/certhash/')
    }

    const source = readFileSync(new URL('./relay-node.ts', import.meta.url), 'utf8')
    // Mentioned in prose is fine; a literal multiaddr fragment is not.
    expect(source).not.toMatch(/['"`][^'"`]*\/certhash\/[^'"`]*['"`]/)
  }, 30_000)

  it('defaults to libp2p’s own documented limits', async () => {
    const relay = await RelayNode.start()
    started.push(relay)
    expect(relay.capacity.limit).toBe(RELAY_MAX_RESERVATIONS)
    // Sanity: the constants module and the relay agree on what is being tuned.
    expect(RELAY_DURATION_LIMIT_MS).toBe(120_000)
    expect(RELAY_DATA_LIMIT_BYTES).toBe(131_072n)
  }, 30_000)
})

describe('NET-05 — exhaustion is reported by name', () => {
  it('pins the libp2p error template this detection depends on', () => {
    // The classifier reads a message string, which is fragile — so both halves are
    // pinned against the installed source. An upgrade that rewords either fails
    // here instead of silently degrading refusals to "unknown failure".
    const require = createRequire(import.meta.url)
    const pkg = dirname(require.resolve('@libp2p/circuit-relay-v2'))

    // The template is built on the transport side, interpolating `response.status`.
    const transport = readFileSync(join(pkg, 'transport', 'reservation-store.js'), 'utf8')
    expect(transport).toContain(RESERVATION_FAILURE_PREFIX)

    // The status *name* that gets interpolated comes from the protobuf Status enum,
    // so that is where it has to be pinned — not in the transport module.
    const pb = readFileSync(join(pkg, 'pb', 'index.js'), 'utf8')
    expect(pb).toContain(STATUS_RESERVATION_REFUSED)
    expect(pb).toContain('PERMISSION_DENIED')

    // The server refuses by returning that status when the store is full.
    const store = readFileSync(join(pkg, 'server', 'reservation-store.js'), 'utf8')
    expect(store).toContain('RESERVATION_REFUSED')
  })

  it('pins the finding that the server dispatches no reservation event', () => {
    // `relay:reservation` is declared in RelayServerEvents but never emitted —
    // it appears only in .d.ts files. `RelayCapacity` therefore has no lifetime
    // counter, because one built on this event would read zero forever. If a
    // release starts emitting it, this test fails and the metric becomes possible.
    const require = createRequire(import.meta.url)
    const pkg = dirname(require.resolve('@libp2p/circuit-relay-v2'))
    const server = readFileSync(join(pkg, 'server', 'index.js'), 'utf8')

    expect(server).not.toContain('relay:reservation')
  })

  it('classifies each protocol status distinctly', () => {
    expect(classifyReservationFailure('reservation failed with status RESERVATION_REFUSED')).toEqual({
      kind: 'at-capacity',
      status: STATUS_RESERVATION_REFUSED,
    })
    expect(classifyReservationFailure('reservation failed with status PERMISSION_DENIED')).toEqual({
      kind: 'refused',
      status: 'PERMISSION_DENIED',
    })
    expect(classifyReservationFailure('reservation failed with status MALFORMED_MESSAGE')).toEqual({
      kind: 'protocol-error',
      status: 'MALFORMED_MESSAGE',
    })
    // Unrelated log lines must be cheap to ignore.
    expect(classifyReservationFailure('dialing peer 12D3Koo…')).toBeNull()
    expect(classifyReservationFailure('')).toBeNull()
  })

  it('grants up to the limit and reports itself at capacity', async () => {
    const relay = await RelayNode.start({ maxReservations: 1 })
    started.push(relay)
    const address = relay.browserDialableAddrs[0]!

    expect(relay.capacity.atCapacity).toBe(false)
    expect(relay.capacity.remaining).toBe(1)

    const first = await startReservingPeer()
    await first.dial(multiaddr(address))
    await until(() => relay.capacity.granted === 1, 20_000, 'the first reservation')

    expect(relay.capacity).toEqual({
      granted: 1,
      limit: 1,
      remaining: 0,
      atCapacity: true,
    })
  }, 60_000)

  it('tells the joining node it is full, distinguishably from being unreachable', async () => {
    const relay = await RelayNode.start({ maxReservations: 1 })
    started.push(relay)
    const address = relay.browserDialableAddrs[0]!

    // Fill the single slot.
    const first = await startReservingPeer()
    await first.dial(multiaddr(address))
    await until(() => relay.capacity.atCapacity, 20_000, 'the relay to fill')

    // A second peer arrives. The relay is reachable — the dial succeeds — so the
    // only thing distinguishing this from an outage is the named status.
    const watcher = new ReservationWatcher()
    const second = await startReservingPeer(watcher)
    const connection = await second.dial(multiaddr(address))
    expect(connection.remotePeer.toString()).toBe(relay.peerId)

    const failure = await watcher.nextCapacityRefusal(30_000)
    expect(failure).not.toBeNull()
    expect(failure?.kind).toBe('at-capacity')
    expect(failure?.status).toBe(STATUS_RESERVATION_REFUSED)
    expect(watcher.sawCapacityRefusal).toBe(true)

    // And the relay's own view says why, rather than leaving it to be inferred.
    expect(relay.capacity.atCapacity).toBe(true)
    expect(relay.capacity.granted).toBe(1)
  }, 60_000)

  it('raises the inbound limits alongside reservations, since both bind first', async () => {
    // Raising maxReservations without raising these leaves the extra capacity
    // unreachable: a burst of joins is rejected mid-handshake, and the dialer sees
    // an EncryptionFailedError that reads like a network fault.
    const relay = await RelayNode.start({ maxReservations: 40 })
    started.push(relay)
    expect(relay.maxIncomingPendingConnections).toBe(40)
    expect(relay.inboundConnectionThreshold).toBe(40)
  }, 30_000)

  it('never lowers an inbound limit below libp2p’s own default', async () => {
    const relay = await RelayNode.start({ maxReservations: 2 })
    started.push(relay)
    expect(relay.maxIncomingPendingConnections).toBe(10)
    expect(relay.inboundConnectionThreshold).toBe(5)
  }, 30_000)

  it('reports capacity for a raised limit, the tuning the browser tier needs', async () => {
    // 16+ simultaneous browser peers is criterion 3's target, which the default 15
    // cannot serve. Confirms the limit is actually applied rather than ignored.
    const relay = await RelayNode.start({ maxReservations: 64 })
    started.push(relay)
    expect(relay.capacity.limit).toBe(64)
    expect(relay.capacity.remaining).toBe(64)
    expect(relay.capacity.atCapacity).toBe(false)
  }, 30_000)
})
