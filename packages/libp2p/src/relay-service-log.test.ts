/**
 * The relay-service log's rules, without a network stack.
 *
 * The behavioural half — that libp2p actually calls `trackProtocolStream` with hop and stop
 * streams, and that the directions come out the way this file assumes — is
 * `relay-service-log.e2e.test.ts`, because it needs a real circuit relay. *A type declaration
 * is not behaviour*, and `Stream.direction` was read out of a `.d.ts` here.
 *
 * What belongs in this file is what the log DOES with a stream once it has one, and the two
 * properties the durable half rests on: the marker is write-once, and a restore adds rather
 * than replaces.
 */

import { describe, expect, it } from 'vitest'
import {
  NO_RELAY_SERVICE,
  RELAY_HOP_PROTOCOL,
  RELAY_STOP_PROTOCOL,
  RelayServiceLog,
} from './relay-service-log.ts'
import type { Stream } from '@libp2p/interface'

/**
 * A stream that carries bytes, with nothing else on it.
 *
 * Deliberately not a partial of the real `Stream`: the log reads three members and wraps two,
 * and a fixture carrying exactly those is one whose completeness can be checked by reading it.
 */
class FakeStream {
  readonly sent: number[] = []
  readonly received: number[] = []

  readonly protocol: string
  readonly direction: 'inbound' | 'outbound'

  constructor(protocol: string, direction: 'inbound' | 'outbound') {
    this.protocol = protocol
    this.direction = direction
  }

  send(data: Uint8Array): boolean {
    this.sent.push(data.byteLength)
    return true
  }

  onData(data: Uint8Array): void {
    this.received.push(data.byteLength)
  }
}

/** Hand a `FakeStream` to the log without asserting it into the interface. */
function observe(log: RelayServiceLog, stream: FakeStream): void {
  const asStream: unknown = stream
  if (!isStream(asStream)) throw new Error('fixture is not stream-shaped')
  log.observe(asStream)
}

function isStream(value: unknown): value is Stream {
  return (
    typeof value === 'object' &&
    value !== null &&
    'protocol' in value &&
    'direction' in value &&
    'send' in value &&
    typeof value.send === 'function'
  )
}

describe('the four roles a relay stream can play', () => {
  it('counts a hop stream opened TO this node as this node being USED as a relay', () => {
    const log = new RelayServiceLog(() => 1_000)
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'inbound'))

    const report = log.report()
    expect(report.inboundHopStreams).toBe(1)
    expect(report.outboundHopStreams).toBe(0)
    expect(report.firstInboundHopStreamAt).toBe(1_000)
  })

  it('counts a hop stream this node OPENED as this node using someone else’s relay', () => {
    const log = new RelayServiceLog(() => 1_000)
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'outbound'))

    const report = log.report()
    expect(report.outboundHopStreams).toBe(1)
    expect(report.inboundHopStreams).toBe(0)
    // **The direction is the whole meaning, and this is the assertion that says so.** A log
    // that counted "hop streams" without it would report a node that has never relayed for
    // anyone identically to one that is carrying the fabric — which is the drift NET-14
    // exists to make visible.
    expect(report.firstInboundHopStreamAt).toBeUndefined()
  })

  it('keeps the two stop directions apart the same way', () => {
    const log = new RelayServiceLog(() => 0)
    observe(log, new FakeStream(RELAY_STOP_PROTOCOL, 'outbound'))
    observe(log, new FakeStream(RELAY_STOP_PROTOCOL, 'inbound'))

    const report = log.report()
    expect(report.outboundStopStreams).toBe(1)
    expect(report.inboundStopStreams).toBe(1)
  })

  it('ignores every other protocol', () => {
    const log = new RelayServiceLog(() => 0)
    // identify and ping run on every connection this node holds. A log that counted them
    // would be a metrics backend rather than an answer to one question.
    observe(log, new FakeStream('/ipfs/id/1.0.0', 'inbound'))
    observe(log, new FakeStream('/ipfs/ping/1.0.0', 'outbound'))
    observe(log, new FakeStream('/o2/kad/1.0.0', 'inbound'))

    expect(log.report()).toEqual(NO_RELAY_SERVICE)
  })

  it('pins the two protocol strings as literals', () => {
    // Written out rather than imported from `@libp2p/circuit-relay-v2`, because the subject
    // is the wire and not that package's constant: if a version renamed the codec, an
    // assertion routed through the package would move with it and could never disagree,
    // while this node would silently stop recognising the streams it is counting.
    expect(RELAY_HOP_PROTOCOL).toBe('/libp2p/circuit/relay/0.2.0/hop')
    expect(RELAY_STOP_PROTOCOL).toBe('/libp2p/circuit/relay/0.2.0/stop')
  })
})

describe('bytes on the streams a relay carries', () => {
  it('counts BOTH directions and calls through', () => {
    const log = new RelayServiceLog(() => 0)
    const stream = new FakeStream(RELAY_HOP_PROTOCOL, 'inbound')
    observe(log, stream)

    stream.send(new Uint8Array(40))
    stream.onData(new Uint8Array(2))

    expect(log.report().bytes).toBe(42)
    // The wrap must observe, not swallow: the fixture has to have seen both.
    expect(stream.sent).toEqual([40])
    expect(stream.received).toEqual([2])
  })

  it('does not wrap a stream on a protocol it ignores', () => {
    const log = new RelayServiceLog(() => 0)
    const stream = new FakeStream('/ipfs/id/1.0.0', 'inbound')
    observe(log, stream)
    stream.send(new Uint8Array(999))

    expect(log.report().bytes).toBe(0)
  })

  it('counts one stream once however often it is offered', () => {
    // libp2p hands the same object to `trackProtocolStream` on the path that opens it, and a
    // second call must not double the count — nor double-wrap `send`, which would make every
    // byte on the stream count twice and inflate the figure silently.
    const log = new RelayServiceLog(() => 0)
    const stream = new FakeStream(RELAY_HOP_PROTOCOL, 'inbound')
    observe(log, stream)
    observe(log, stream)

    stream.send(new Uint8Array(10))

    expect(log.report().inboundHopStreams).toBe(1)
    expect(log.report().bytes).toBe(10)
  })
})

describe('the marker is write-once, because it names a beginning', () => {
  it('keeps the FIRST inbound hop stream’s time, not the latest', () => {
    let clock = 5_000
    const log = new RelayServiceLog(() => clock)
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'inbound'))
    clock = 9_000
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'inbound'))

    // 5_000 as a literal and not `firstObservation`: an assertion that reused the value it
    // tests would stay green if both sides moved together.
    expect(log.report().firstInboundHopStreamAt).toBe(5_000)
    expect(log.report().inboundHopStreams).toBe(2)
  })

  it('is not moved by a LATER restored marker', () => {
    let clock = 5_000
    const log = new RelayServiceLog(() => clock)
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'inbound'))
    clock = 9_000
    log.restore({ ...NO_RELAY_SERVICE, inboundHopStreams: 3, firstInboundHopStreamAt: 8_000 })

    expect(log.report().firstInboundHopStreamAt).toBe(5_000)
  })

  it('IS moved by an EARLIER restored marker, which is a correction and not a rollback', () => {
    const log = new RelayServiceLog(() => 5_000)
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'inbound'))
    log.restore({ ...NO_RELAY_SERVICE, inboundHopStreams: 1, firstInboundHopStreamAt: 200 })

    expect(log.report().firstInboundHopStreamAt).toBe(200)
  })
})

describe('restore is additive, so a late read cannot lose an early observation', () => {
  it('adds the stored totals to what has already been seen', () => {
    // The ordinary case on a Durable Object, not a corner one: an instance can answer a
    // request while its journal read is still in flight.
    const log = new RelayServiceLog(() => 7_000)
    observe(log, new FakeStream(RELAY_HOP_PROTOCOL, 'inbound'))
    observe(log, new FakeStream(RELAY_STOP_PROTOCOL, 'outbound'))

    log.restore({
      inboundHopStreams: 40,
      outboundHopStreams: 2,
      outboundStopStreams: 30,
      inboundStopStreams: 1,
      bytes: 900,
      firstInboundHopStreamAt: 100,
    })

    expect(log.report()).toEqual({
      inboundHopStreams: 41,
      outboundHopStreams: 2,
      outboundStopStreams: 31,
      inboundStopStreams: 1,
      bytes: 900,
      firstInboundHopStreamAt: 100,
    })
  })

  it('reports `restored` so a caller can tell a fresh log from one with a history', () => {
    const log = new RelayServiceLog(() => 0)
    expect(log.restored).toBe(false)
    log.restore(NO_RELAY_SERVICE)
    // True after restoring EMPTY totals, deliberately: the flag says *this log has been given
    // a starting point*, which is the question the journal's writer asks. A flag that meant
    // "has history" would make a genuinely-new node unbankable forever.
    expect(log.restored).toBe(true)
  })

  it('starts at exactly `NO_RELAY_SERVICE`', () => {
    expect(new RelayServiceLog(() => 0).report()).toEqual(NO_RELAY_SERVICE)
  })
})
