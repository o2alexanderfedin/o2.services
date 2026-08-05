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
import { publicNodes, submitJob } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import {
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
} from '@o2/libp2p'
import { FabricNode } from './fabric-node.ts'
import {
  RESERVATION_FAILURE_PREFIX,
  ReservationWatcher,
  STATUS_RESERVATION_REFUSED,
  classifyReservationFailure,
} from './reservation-watch.ts'

/**
 * NET-03 / NET-05 — relaying as a capability, and exhaustion reported by name.
 *
 * The subject is a *node that also relays*, not "a relay". There is no relay class
 * to test: `FabricNode` turns the circuit-relay service on when it has bound an
 * address others can reach, and every one of those nodes executes tasks too. The
 * first two tests in the last block are what hold that — remove `serveAgent` from
 * the construction path, or the relay service from it, and one of them fails.
 */

const started: { stop(): void | Promise<void> }[] = []

/**
 * A node that can relay, which here means only: one that bound a real address.
 *
 * No flag is passed and none exists. `FabricNode` reads the listen list — that is
 * the whole of the mechanism, and asserting against a node built this way is how
 * these tests stay honest about it. WebSockets because that is what a browser can
 * dial, and because the previous `RelayNode.start()` defaulted to it silently.
 */
async function relayingNode(
  options: { maxReservations?: number } = {},
): Promise<FabricNode> {
  return FabricNode.start({
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // DET-03: this file's subject is that relaying is derived from the listen list and
    // that a relayed node is not a lesser node — every dispatch here is in-process on
    // the node being configured, and provenance is not what is being read. Stated
    // rather than defaulted, which is the whole point of the field being required: a
    // reader counting this literal learns which tests do not exercise the signed path.
    // No job in this file carries a `moduleRecord` either — a node running with the
    // opt-out has no guard to satisfy, and a record here would be decoration the next
    // reader would mistake for a requirement.
    trustAnchors: 'runs-unsigned-artifacts',
    ...options,
  })
}

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

describe('NET-03 — a listening node presents a browser-dialable address', () => {
  it('listens on WebSockets, which is one of the three things a browser can dial', async () => {
    const relay = await relayingNode()
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
    const relay = await relayingNode()
    started.push(relay)
    for (const address of relay.multiaddrs) {
      expect(address).not.toContain('/certhash/')
    }

    const source = readFileSync(new URL('./fabric-node.ts', import.meta.url), 'utf8')
    // Mentioned in prose is fine; a literal multiaddr fragment is not.
    expect(source).not.toMatch(/['"`][^'"`]*\/certhash\/[^'"`]*['"`]/)
  }, 30_000)

  it('defaults to libp2p’s own documented limits', async () => {
    const relay = await relayingNode()
    started.push(relay)
    expect(relay.capacity.limit).toBe(RELAY_MAX_RESERVATIONS)
    // Sanity: the constants module and the node agree on what is being tuned.
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
    const relay = await relayingNode({ maxReservations: 1 })
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
    const relay = await relayingNode({ maxReservations: 1 })
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

    // NET-05's lost wakeup, guarded deterministically and with no race to lose.
    //
    // The refusal above is already recorded by the time these lines run, so a listener
    // subscribed *now* is exactly the case `bin/agent.ts` met in production: it
    // subscribed after `FabricNode.start`, the relay dial happens inside `start`, and
    // roughly one node in five was therefore never told it had been refused — reported
    // instead as the outcome that cannot tell a full relay from a silent one.
    //
    // This case is the cheap half of the pair, and the half that cannot flake. The
    // cross-process reading in `reservation-exhaustion.node.test.ts` is the expensive
    // half, and it is the one that was ~80% reliable for weeks *because this property
    // was never asserted anywhere*. `nextCapacityRefusal` has always replayed, which is
    // precisely why this file stayed green while the other file did not — the asymmetry
    // between the two methods was the whole defect.
    //
    // Reddened by removing the replay loop from `ReservationWatcher.onFailure`: this
    // reads `[]`.
    const afterTheFact: string[] = []
    watcher.onFailure((failure) => afterTheFact.push(failure.kind))
    expect(afterTheFact).toContain('at-capacity')
    expect(afterTheFact).toHaveLength(watcher.failures.length)
  }, 60_000)

  it('raises the inbound limits alongside reservations, since both bind first', async () => {
    // Raising maxReservations without raising these leaves the extra capacity
    // unreachable: a burst of joins is rejected mid-handshake, and the dialer sees
    // an EncryptionFailedError that reads like a network fault.
    const relay = await relayingNode({ maxReservations: 40 })
    started.push(relay)
    expect(relay.maxIncomingPendingConnections).toBe(40)
    expect(relay.inboundConnectionThreshold).toBe(40)
  }, 30_000)

  it('never lowers an inbound limit below libp2p’s own default', async () => {
    const relay = await relayingNode({ maxReservations: 2 })
    started.push(relay)
    expect(relay.maxIncomingPendingConnections).toBe(10)
    expect(relay.inboundConnectionThreshold).toBe(5)
  }, 30_000)

  it('reports capacity for a raised limit, the tuning the browser tier needs', async () => {
    // 16+ simultaneous browser peers is criterion 3's target, which the default 15
    // cannot serve. Confirms the limit is actually applied rather than ignored.
    const relay = await relayingNode({ maxReservations: 64 })
    started.push(relay)
    expect(relay.capacity.limit).toBe(64)
    expect(relay.capacity.remaining).toBe(64)
    expect(relay.capacity.atCapacity).toBe(false)
  }, 30_000)
})

/**
 * The standing rule, pinned in one place.
 *
 * All nodes have equal functionality. There is no tier, no class, no lesser node.
 * The only difference is discovery: a browser binds no listening socket, so it
 * cannot be a seed a newcomer dials cold and must be found through a peer that can.
 * Once connected, peers are indistinguishable.
 *
 * These two tests are the mechanism that keeps that true rather than asserted. The
 * class this file used to test — `RelayNode` — constructed no blockstore, no
 * executor and no `RpcEndpoint`, and never called `serveAgent`, so it could not run
 * a task at all. Every test in it passed. The gap showed up only in a running demo
 * reporting "2 compute peers of 3 connections", with nothing able to say why.
 */
describe('the rule: relaying and executing are the same node', () => {
  it('runs a task dispatched to it while holding somebody’s reservation', async () => {
    const both = await relayingNode({ maxReservations: 4 })
    started.push(both)
    const address = both.browserDialableAddrs[0]!

    // A peer in the browser's position: no address of its own, reachable only
    // through `both`.
    const guest = await FabricNode.start({
      listen: [],
      relayAddrs: [address],
      rpcTimeoutMs: 30_000,
      // DET-03 — see `relayingNode` above.
      trustAnchors: 'runs-unsigned-artifacts',
    })
    started.push(guest)
    await until(() => both.capacity.granted === 1, 30_000, 'the reservation')

    // Only the guest holds the module; the relaying node must pull it over the same
    // connection it is carrying a circuit on.
    const moduleCid = await guest.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(both.peerId, guest.rpc, 'dispatches-unauthenticated')]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      guest.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    // Named, so this cannot pass by the guest quietly executing its own shards.
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual([both.peerId])
    }

    // And it was relaying throughout — not "relayed once, then became a worker".
    expect(both.relays).toBe(true)
    expect(both.capacity.granted).toBe(1)
    expect(both.reservedPeerIds).toContain(guest.peerId)
  }, 90_000)

  it('offers no relay service when it has no address of its own, and still computes', async () => {
    const host = await relayingNode({ maxReservations: 4 })
    started.push(host)

    const guest = await FabricNode.start({
      listen: [],
      relayAddrs: [host.browserDialableAddrs[0]!],
      rpcTimeoutMs: 30_000,
      // DET-03 — see `relayingNode` above. This node does execute, and the job below
      // carries no record for exactly the reason stated there.
      trustAnchors: 'runs-unsigned-artifacts',
    })
    started.push(guest)
    await until(() => guest.circuitAddrs.length > 0, 30_000, 'a circuit address')

    // The mirror of the rule. A node reachable only through somebody else cannot
    // carry a stranger's handshake, so it does not advertise that it can — and this
    // is derived from the listen list, never declared, which is why there is no
    // option here to have set wrongly.
    expect(guest.relays).toBe(false)
    expect(guest.libp2p.services['relay']).toBeUndefined()
    expect(guest.capacity).toEqual({ granted: 0, limit: 0, remaining: 0, atCapacity: true })
    expect(guest.reservedPeerIds).toEqual([])

    // Not a lesser node. It executes exactly what the listening one executes,
    // dispatched over the connection it opened.
    await until(() => host.transport.peers.includes(guest.peerId), 30_000, 'the peer to appear')
    const moduleCid = await host.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(guest.peerId, host.rpc, 'dispatches-unauthenticated')]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      host.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual([guest.peerId])
    }
  }, 90_000)
})
