/**
 * NET-14's classifier and its arithmetic, without a network stack.
 *
 * The behavioural half — that libp2p actually calls `trackMultiaddrConnection`, that the wrap
 * sees bytes, and that a relayed arrangement reports differently from a direct one — is
 * `traffic-split.e2e.test.ts`, because it needs real sockets. What belongs here is the rule
 * that decides which column a connection lands in, and the one case that rule exists for.
 */

import { multiaddr } from '@multiformats/multiaddr'
import { Circuit, WebRTC } from '@multiformats/multiaddr-matcher'
import { describe, expect, it } from 'vitest'
import { TrafficSplitCounter, classifyConnection } from './traffic-split.ts'
import type { MultiaddrConnection } from '@libp2p/interface'

const RELAY = '12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN'
const SELF = '12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz'

describe('NET-14 — which column a connection lands in', () => {
  it('calls a plain WebSocket dial DIRECT', () => {
    expect(classifyConnection(multiaddr(`/ip4/127.0.0.1/tcp/4001/ws/p2p/${SELF}`))).toBe('direct')
  })

  it('calls a `/p2p-circuit` connection RELAYED', () => {
    expect(
      classifyConnection(multiaddr(`/ip4/1.2.3.4/tcp/443/tls/ws/p2p/${RELAY}/p2p-circuit/p2p/${SELF}`)),
    ).toBe('relayed')
  })

  it('calls a browser’s WebRTC connection DIRECT, THOUGH ITS ADDRESS NAMES A RELAY', () => {
    // **The case this classifier exists for — and the plant for it STAYS GREEN, measured.**
    // A direct browser-to-browser WebRTC connection keeps the signalling relay in its
    // address long after the relay has left the data path, so a classifier that read that
    // address as relayed would report every direct browser pair as relayed: the fabric
    // declaring itself hosted-in-practice on the strength of its own counter.
    //
    // Swapping the two branches in `classifyConnection` was run on 2026-08-30 and left this
    // file green, because `@multiformats/multiaddr-matcher@3.0.2` answers `Circuit.matches`
    // **false** for this form. The library already disambiguates. That is recorded rather
    // than quietly kept as a plant nobody re-ran, and the case below is what actually holds
    // the property: it pins the LIBRARY's answer, so a version that starts matching the form
    // as a circuit reddens there and this ordering becomes load-bearing.
    expect(
      classifyConnection(
        multiaddr(`/ip4/1.2.3.4/tcp/443/tls/ws/p2p/${RELAY}/p2p-circuit/webrtc/p2p/${SELF}`),
      ),
    ).toBe('direct')
  })

  it('pins the LIBRARY’s reading of that form, which is what the ordering rests on', () => {
    // Measured 2026-08-30 against `@multiformats/multiaddr-matcher@3.0.2`. Written as
    // literals rather than derived from `classifyConnection`, because the subject here is the
    // dependency and not this repository's function — an assertion routed through our own
    // classifier would move with it and could never disagree.
    const browserWebRtc = multiaddr(
      `/ip4/1.2.3.4/tcp/443/tls/ws/p2p/${RELAY}/p2p-circuit/webrtc/p2p/${SELF}`,
    )
    expect(Circuit.matches(browserWebRtc)).toBe(false)
    expect(Circuit.exactMatch(browserWebRtc)).toBe(false)
    expect(WebRTC.matches(browserWebRtc)).toBe(true)
  })

  it('calls WebRTC-Direct DIRECT', () => {
    expect(
      classifyConnection(
        multiaddr(`/ip4/1.2.3.4/udp/4001/webrtc-direct/certhash/uEiAUaMtIXLBWLPtRAK6IesLotXtM9jsdHqDdsPeZeUcuWQ/p2p/${SELF}`),
      ),
    ).toBe('direct')
  })
})

/**
 * A connection that carries bytes and closes, with nothing else on it.
 *
 * `EventTarget` rather than a hand-rolled listener list, because the counter subscribes with
 * `addEventListener` and a stand-in that only looked like one would prove nothing about it.
 */
class FakeConnection extends EventTarget {
  readonly remoteAddr
  readonly sent: number[] = []

  constructor(address: string) {
    super()
    this.remoteAddr = multiaddr(address)
  }

  send(data: Uint8Array): boolean {
    this.sent.push(data.byteLength)
    return true
  }

  onData(_data: Uint8Array): void {}

  closeNow(): void {
    this.dispatchEvent(new Event('close'))
  }
}

/** Hand a `FakeConnection` to the counter without asserting it into the interface. */
function track(counter: TrafficSplitCounter, connection: FakeConnection): void {
  const asConnection: unknown = connection
  if (!isMultiaddrConnection(asConnection)) throw new Error('fixture is not connection-shaped')
  counter.track(asConnection)
}

function isMultiaddrConnection(value: unknown): value is MultiaddrConnection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'remoteAddr' in value &&
    'send' in value &&
    typeof value.send === 'function'
  )
}

describe('NET-14 — the two counters', () => {
  it('counts bytes in BOTH directions on one connection', () => {
    const counter = new TrafficSplitCounter(() => 0)
    const connection = new FakeConnection(`/ip4/127.0.0.1/tcp/4001/ws/p2p/${SELF}`)
    track(counter, connection)

    connection.send(new Uint8Array(10))
    connection.onData(new Uint8Array(7))

    expect(counter.report().direct.bytes).toBe(17)
    // The wrap must call through, not swallow: the fixture has to have seen the write.
    expect(connection.sent).toEqual([10])
  })

  it('keeps the two columns apart', () => {
    const counter = new TrafficSplitCounter(() => 0)
    const direct = new FakeConnection(`/ip4/127.0.0.1/tcp/4001/ws/p2p/${SELF}`)
    const relayed = new FakeConnection(
      `/ip4/1.2.3.4/tcp/443/tls/ws/p2p/${RELAY}/p2p-circuit/p2p/${SELF}`,
    )
    track(counter, direct)
    track(counter, relayed)

    direct.send(new Uint8Array(100))
    relayed.send(new Uint8Array(3))

    const split = counter.report()
    expect(split.direct.bytes).toBe(100)
    expect(split.relayed.bytes).toBe(3)
  })

  it('counts a connection that is STILL OPEN, which is every working connection', () => {
    // A counter that only banked on close would report zero for a healthy fabric. Plant that
    // reddens this: drop the live-connection loop from `report`.
    let clock = 1_000
    const counter = new TrafficSplitCounter(() => clock)
    track(counter, new FakeConnection(`/ip4/127.0.0.1/tcp/4001/ws/p2p/${SELF}`))

    clock = 4_000

    expect(counter.report().direct.connectionSeconds).toBe(3)
  })

  it('does not count a closed connection twice, nor keep it running', () => {
    let clock = 1_000
    const counter = new TrafficSplitCounter(() => clock)
    const connection = new FakeConnection(`/ip4/127.0.0.1/tcp/4001/ws/p2p/${SELF}`)
    track(counter, connection)

    clock = 3_000
    connection.closeNow()
    clock = 99_000

    expect(counter.report().direct.connectionSeconds).toBe(2)
  })

  it('reports two zeroed columns before anything has connected', () => {
    // Not vacuous cheer: the report must be readable from before the relay carries anything,
    // which is criterion 3's whole ordering claim. A counter that threw or answered
    // `undefined` until its first connection could not be reported "from the first day".
    expect(new TrafficSplitCounter(() => 0).report()).toEqual({
      direct: { connectionSeconds: 0, bytes: 0 },
      relayed: { connectionSeconds: 0, bytes: 0 },
    })
  })
})
