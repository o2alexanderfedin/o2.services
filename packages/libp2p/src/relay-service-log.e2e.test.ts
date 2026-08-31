/**
 * The relay-service log against a real circuit relay — the half a `.d.ts` cannot settle.
 *
 * The unit file proves what the log does with a stream once it has one. Three separate links
 * are outside its reach, and a green unit suite would survive any of them being broken:
 *
 * 1. **libp2p calls `trackProtocolStream` at all** — it was inert in `trafficSplitMetrics`
 *    until 2026-08-30, so nothing had ever exercised that seam here.
 * 2. **The hop and stop codecs on the wire are the strings this file pins.** They were read
 *    out of `@libp2p/circuit-relay-v2/dist/src/constants.js`, which is a declaration.
 * 3. **`Stream.direction` is what the log assumes it is** — that a peer reserving on a relay
 *    produces an *inbound* hop stream **at the relay** and an *outbound* one at the peer.
 *    That was read out of `@libp2p/interface/dist/src/message-stream.d.ts:83`. *A type
 *    declaration is not behaviour.*
 *
 * Link 3 is the one worth the file on its own: every counter's meaning depends on it, and a
 * log that had the two directions the wrong way round would report a relay that has never
 * carried anyone as the busiest node in the fabric — with every individual number looking
 * perfectly reasonable.
 *
 * ## Why three nodes with a log on two of them
 *
 * A relay's own reading and its client's reading are the two halves of the same event, and
 * asserting only one of them cannot tell a correct log from one that counts every hop stream
 * regardless of direction. Reading both, from the same reservation, is what makes the
 * direction claim checkable rather than assumed.
 *
 * ## `.e2e.test.ts`, deliberately
 *
 * Three libp2p nodes and real sockets on ephemeral ports, exactly as
 * `traffic-split.e2e.test.ts` — whose arrangement this reuses. The `e2e` lane runs
 * `fileParallelism: false`; the `node` lane does not.
 */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from 'libp2p'
import { afterEach, describe, expect, it } from 'vitest'
import { RelayServiceLog } from './relay-service-log.ts'
import type { RelayServiceTotals } from './relay-service-log.ts'
import { TrafficSplitCounter, trafficSplitMetrics } from './traffic-split.ts'

const started: Libp2p[] = []

afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (node) => Promise.resolve(node.stop()).catch(() => undefined)),
  )
})

async function start<T extends Libp2p>(node: T): Promise<T> {
  await node.start()
  started.push(node)
  return node
}

/** Wait until a field on one log has moved, so a reading is not taken mid-handshake. */
async function waitFor(
  log: RelayServiceLog,
  field: keyof RelayServiceTotals,
  what: string,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const value = log.report()[field]
    if (value !== undefined && value > 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${what} did not appear within 20 s`)
}

describe('what a real circuit relay puts through `trackProtocolStream`', () => {
  it('records the reservation at the RELAY as inbound and at the CLIENT as outbound', async () => {
    const relayLog = new RelayServiceLog()
    const relay = await start(
      await createLibp2p({
        addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
        transports: [webSockets()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        metrics: () => trafficSplitMetrics(new TrafficSplitCounter(), relayLog),
        services: {
          identify: identify(),
          ping: ping(),
          relay: circuitRelayServer({ reservations: { maxReservations: 8 } }),
        },
      }),
    )
    const relayAddress = relay.getMultiaddrs()[0]
    if (relayAddress === undefined) throw new Error('the relay announced no address')

    // Before anything reserves. The zeroed reading is itself the claim — a log that answered
    // `undefined` here could not be reported from before the relay carries its first peer,
    // which is the whole ordering the hosted tier's `/self` field exists to make visible.
    expect(relayLog.report().inboundHopStreams).toBe(0)
    expect(relayLog.report().firstInboundHopStreamAt).toBeUndefined()

    const targetLog = new RelayServiceLog()
    const target = await start(
      await createLibp2p({
        addresses: { listen: ['/p2p-circuit'] },
        transports: [webSockets(), circuitRelayTransport()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        metrics: () => trafficSplitMetrics(new TrafficSplitCounter(), targetLog),
        services: { identify: identify(), ping: ping() },
      }),
    )
    await target.dial(relayAddress, { signal: AbortSignal.timeout(20_000) })

    await waitFor(relayLog, 'inboundHopStreams', 'a hop stream at the relay')

    // **Link 3, and the direction is asserted from BOTH ends of one event.** The relay saw it
    // arrive; the target saw itself open it. A log that ignored `direction` would report
    // `inboundHopStreams` on the target too, and this pair is what refuses that.
    const atRelay = relayLog.report()
    const atTarget = targetLog.report()
    expect(atRelay.inboundHopStreams).toBeGreaterThan(0)
    expect(atRelay.outboundHopStreams).toBe(0)
    expect(atTarget.outboundHopStreams).toBeGreaterThan(0)
    expect(atTarget.inboundHopStreams).toBe(0)

    // The marker is set at the relay and only at the relay: the target has never been used
    // as one. Non-zero rather than a literal — the value is a wall clock.
    expect(atRelay.firstInboundHopStreamAt).toBeGreaterThan(0)
    expect(atTarget.firstInboundHopStreamAt).toBeUndefined()

    // Bytes moved on the hop stream, which is the seam the forwarded payload flows over once
    // a CONNECT is spliced. Non-zero, not a literal: the reservation protobuf's size is the
    // library's business and pinning it would make this a change-detector.
    expect(atRelay.bytes).toBeGreaterThan(0)
  }, 120_000)

  it('records a relayed dial as an outbound STOP at the relay and an inbound one at the target', async () => {
    const relayLog = new RelayServiceLog()
    const relay = await start(
      await createLibp2p({
        addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
        transports: [webSockets()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        metrics: () => trafficSplitMetrics(new TrafficSplitCounter(), relayLog),
        services: {
          identify: identify(),
          ping: ping(),
          relay: circuitRelayServer({ reservations: { maxReservations: 8 } }),
        },
      }),
    )
    const relayAddress = relay.getMultiaddrs()[0]
    if (relayAddress === undefined) throw new Error('the relay announced no address')

    const targetLog = new RelayServiceLog()
    const target = await start(
      await createLibp2p({
        addresses: { listen: ['/p2p-circuit'] },
        transports: [webSockets(), circuitRelayTransport()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        metrics: () => trafficSplitMetrics(new TrafficSplitCounter(), targetLog),
        services: { identify: identify(), ping: ping() },
      }),
    )
    await target.dial(relayAddress, { signal: AbortSignal.timeout(20_000) })

    const deadline = Date.now() + 20_000
    let circuit = target.getMultiaddrs().find((one) => one.toString().includes('/p2p-circuit'))
    while (circuit === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      circuit = target.getMultiaddrs().find((one) => one.toString().includes('/p2p-circuit'))
    }
    if (circuit === undefined) throw new Error('the target never obtained a relayed address')

    const dialler = await start(
      await createLibp2p({
        transports: [webSockets(), circuitRelayTransport()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: { identify: identify() },
      }),
    )
    await dialler.dial(multiaddr(circuit.toString()), { signal: AbortSignal.timeout(20_000) })

    await waitFor(relayLog, 'outboundStopStreams', 'a stop stream from the relay')
    await waitFor(targetLog, 'inboundStopStreams', 'a stop stream at the target')

    const atRelay = relayLog.report()
    const atTarget = targetLog.report()
    // The relay DELIVERED — it opened the stop stream. The target RECEIVED one. Each node
    // sees exactly one side of the same delivery, which is the claim.
    expect(atRelay.outboundStopStreams).toBeGreaterThan(0)
    expect(atRelay.inboundStopStreams).toBe(0)
    expect(atTarget.inboundStopStreams).toBeGreaterThan(0)
    expect(atTarget.outboundStopStreams).toBe(0)

    // The dialler's CONNECT arrives at the relay as another inbound hop — so the relay's
    // count of "someone used me" covers both reserving and connecting, which is why the
    // marker is named for the stream and not for a reservation. Two peers used this relay.
    expect(atRelay.inboundHopStreams).toBeGreaterThan(1)
  }, 120_000)
})
