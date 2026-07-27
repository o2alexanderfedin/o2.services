import { findReservedPeers } from '@o2/net'
import { afterEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-03 / DEMO-03 — two nodes find each other over the wire, with no help.
 *
 * `findReservedPeers` is documented in the demo as *the only route on a static
 * host*: a browser binds no listening socket, so no tab can be dialled cold and none
 * will ever announce itself. The node holding their reservations already knows who is
 * present, so the rendezvous is one request over the fabric's own protocol.
 *
 * That request answered `[]` for the whole of Phase 9. `FabricNode.reservedPeerIds`
 * held exactly the right data; `serveAgent` was never given it. The milestone audit
 * found it, and the reason nothing else did is the point of this file.
 *
 * ## Why every existing test missed it
 *
 * `rendezvous.test.ts` supplies the answer it then checks — it builds an endpoint
 * whose handler returns a peer list, which proves the *merging* is right and can say
 * nothing about whether any real node answers. `seed-discovery.e2e.test.ts` does
 * genuinely self-organise, but over the **origin** route: `SeedServer` reads
 * `reservedPeerIds` in-process (`seed-server.ts:240`) and writes it into
 * `/bootstrap.json`, never asking over the wire. So the LAN demo worked and hid a
 * static-host route that could not work at all.
 *
 * And the failure was silent in the worst way. The relay *does* answer, so
 * `answered` is non-zero and the caller records `asked: true` — then dials the empty
 * list and reports `{asked: true, dialed: [], failed: []}`. Nothing attempted,
 * nothing failed, no error. That is the same signature as the two-device defect found
 * on real hardware last session, one tier down.
 *
 * So the rule this file encodes: **the answer must come from a node nobody
 * configured to give it.** Nothing below installs a handler, seeds a peer list, or
 * tells any node about any other. The relay learns who is present by relaying, and
 * is asked over the same protocol a browser would use.
 *
 * Node-only: it starts real libp2p nodes on real sockets.
 */

const started: FabricNode[] = []

afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (node) => {
      try {
        await node.stop()
      } catch {
        // A node that already failed to start is not worth failing teardown over.
      }
    }),
  )
})

/** A node that relays, which here means only: one that bound a real address. */
async function relayingNode(): Promise<FabricNode> {
  const node = await FabricNode.start({ listen: ['/ip4/127.0.0.1/tcp/0/ws'] })
  started.push(node)
  return node
}

/**
 * A node reachable only through a relay — the Node-side stand-in for a browser tab.
 *
 * `/p2p-circuit` in the listen list is what makes libp2p request a reservation from
 * any relay it connects to. It binds no socket of its own, which is the only
 * difference between it and the node above.
 */
async function reservingNode(relay: FabricNode): Promise<FabricNode> {
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay bound no browser-dialable address')
  const node = await FabricNode.start({ listen: ['/p2p-circuit'], relayAddrs: [address] })
  started.push(node)
  return node
}

async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('a node asked over the wire says who is reserved on it', () => {
  it('answers with the live reservation set, not an empty list', async () => {
    const relay = await relayingNode()
    const alice = await reservingNode(relay)
    await until(() => relay.reservedPeerIds.length === 1, 15_000, 'alice to reserve')

    // Asked over the protocol, by a peer, exactly as a browser would ask.
    const found = await findReservedPeers({
      rpc: alice.rpc,
      peers: () => alice.transport.peers,
      self: alice.peerId,
    })

    expect(found.answered).toBeGreaterThan(0)
    // Alice is the only reservation, and she is excluded as self — so the relay
    // answered truthfully and there is nobody else yet. `answered > 0` with no
    // addresses is the *correct* empty, and is what the next test distinguishes it
    // from.
    expect(found.addrs).toEqual([])
  }, 60_000)

  it('lets two nodes on one relay discover each other, with nothing supplied', async () => {
    // The claim in one test. Neither node is told the other exists; neither can be
    // dialled cold. If this passes, they found each other through the fabric.
    const relay = await relayingNode()
    const alice = await reservingNode(relay)
    const bob = await reservingNode(relay)
    await until(() => relay.reservedPeerIds.length === 2, 15_000, 'both peers to reserve')

    const found = await findReservedPeers({
      rpc: alice.rpc,
      peers: () => alice.transport.peers,
      self: alice.peerId,
    })

    expect(found.answered).toBeGreaterThan(0)
    expect(found.addrs).toHaveLength(1)
    const [address] = found.addrs
    // The address is only meaningful relative to the peer that reported it: a
    // reservation is held *on* the relay, so the route to its holder goes through
    // the relay. Asserted whole rather than by `includes`, because a substring match
    // against a structured address is how the last discovery defect survived — the
    // relay's own id appears inside every one of these.
    expect(address).toBe(`/p2p/${relay.peerId}/p2p-circuit/webrtc/p2p/${bob.peerId}`)
    expect(address).not.toContain(`/webrtc/p2p/${alice.peerId}`)
  }, 60_000)

  it('is symmetric — bob finds alice by the same route', async () => {
    // Otherwise the first tab to arrive could see the second while the second could
    // never see the first, and which tab you opened first would decide whether the
    // demo worked.
    const relay = await relayingNode()
    const alice = await reservingNode(relay)
    const bob = await reservingNode(relay)
    await until(() => relay.reservedPeerIds.length === 2, 15_000, 'both peers to reserve')

    const fromBob = await findReservedPeers({
      rpc: bob.rpc,
      peers: () => bob.transport.peers,
      self: bob.peerId,
    })
    expect(fromBob.addrs).toEqual([
      `/p2p/${relay.peerId}/p2p-circuit/webrtc/p2p/${alice.peerId}`,
    ])
  }, 60_000)

  it('distinguishes a relay with no guests from a peer that never answered', async () => {
    // `answered` is the whole of that distinction, and it is why the empty case above
    // is not enough on its own. A caller that only looked at `addrs` would read "the
    // fabric is empty" and "nobody is listening" as the same fact, and the second is
    // the one worth acting on.
    const relay = await relayingNode()
    const alice = await reservingNode(relay)
    await until(() => relay.reservedPeerIds.length === 1, 15_000, 'alice to reserve')

    const real = await findReservedPeers({
      rpc: alice.rpc,
      peers: () => alice.transport.peers,
      self: alice.peerId,
    })
    const nobody = await findReservedPeers({
      rpc: alice.rpc,
      peers: () => ['12D3KooWNoSuchPeerExistsAnywhereInThisFabricAtAll'],
      self: alice.peerId,
    })

    expect(real.addrs).toEqual(nobody.addrs) // both empty
    expect(real.answered).toBeGreaterThan(0)
    expect(nobody.answered).toBe(0)
  }, 60_000)
})
