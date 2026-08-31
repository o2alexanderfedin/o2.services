/**
 * What this node has done as a circuit relay, and what other relays have done for it —
 * recorded as it happens, so the question can be asked afterwards.
 *
 * ## Why this exists: a question that was asked and could not be answered
 *
 * Phase 32 criterion 3 asks whether the traffic split was readable **before** the deployed
 * relay first carried a browser. On 2026-08-30 that turned out to be unanswerable from the
 * node itself, for a reason worth writing down rather than working around: `TrafficSplitCounter`
 * is per-instance and holds no history, so a Durable Object that was evicted between the
 * reservation and the reading answers as if the reservation never happened. The counters
 * describe a moment; the question was about an order of events.
 *
 * A node that cannot say what it has done cannot be asked. So this file records the events,
 * {@link RelayServiceTotals} is the shape they are read back in, and the hosted tier banks
 * them somewhere that survives eviction.
 *
 * **The window before rc.6 stays dark.** Nothing here reconstructs history it did not
 * observe, and criterion 3's verdict — unverified, possibly permanently false — does not move
 * because of this file. What changes is that the *next* such question has an answer.
 *
 * ## Why the marker is called `firstInboundHopStreamAt` and not `firstReservationAt`
 *
 * Because that is what it detects. A hop stream carries either a RESERVE or a CONNECT
 * (`@libp2p/circuit-relay-v2/dist/src/constants.js:35`), and the protocol string is identical
 * for both — telling them apart means reading the protobuf off the stream, which would consume
 * the bytes the relay is about to forward. `@libp2p/circuit-relay-v2`'s server emits no event
 * either: measured 2026-08-30, `dispatchEvent` and `safeDispatchEvent` appear **nowhere** under
 * `dist/src/server/`, so there is no cleaner seam to prefer. The honest name is the one that
 * survives someone checking it.
 *
 * ## Four counters, because which side opened the stream is the whole meaning
 *
 * | field | what it means for this node |
 * |---|---|
 * | `inboundHopStreams` | someone used **this node** as their relay |
 * | `outboundHopStreams` | this node reserved on, or dialled through, **someone else's** relay |
 * | `outboundStopStreams` | this node **delivered** a relayed connection to a peer holding a reservation with it |
 * | `inboundStopStreams` | someone's relay delivered a connection **to** this node |
 *
 * The first and third are the relay-service side; the second and fourth are the client side.
 * A hosted relay that is drifting toward carrying the fabric shows it in the first two rows
 * moving apart, which is the drift NET-14 exists to make visible and which a single "relay
 * streams" total would hide.
 *
 * ## `bytes` OVERLAPS the traffic split, deliberately, and must not be subtracted from it
 *
 * `TrafficSplitCounter` counts at `trackMultiaddrConnection`, which is every byte on every
 * connection this node holds — including the payload it forwards for someone else, which
 * lands in that counter's `direct` column because the connection to the reserving peer *is*
 * direct. The number here is the **same payload counted again**, at a different question:
 * `direct` answers *bytes on connections I hold*, `bytes` here answers *payload I carried for
 * others, or that others carried for me*. The two are not a partition and the difference is
 * not meaningful arithmetic either — the maConn figure includes Noise and muxer framing that
 * never reaches a stream. Report them side by side; never reconcile them by subtraction.
 *
 * Counting bytes on the hop stream is the right seam for the forwarded payload and not an
 * approximation of it: after a CONNECT succeeds, circuit-relay-v2 splices the hop stream to
 * the stop stream and the relayed traffic flows over exactly these two.
 */

import type { Stream } from '@libp2p/interface'

/** The reservation and connect protocol — `@libp2p/circuit-relay-v2/dist/src/constants.js:35`. */
export const RELAY_HOP_PROTOCOL = '/libp2p/circuit/relay/0.2.0/hop'

/** The delivery protocol — `@libp2p/circuit-relay-v2/dist/src/constants.js:39`. */
export const RELAY_STOP_PROTOCOL = '/libp2p/circuit/relay/0.2.0/stop'

/**
 * What {@link RelayServiceLog.report} answers.
 *
 * Every field is a lifetime total from this log's point of view: whatever it was restored
 * with, plus whatever it has observed since. See the file header for what each counter means
 * and for why `bytes` overlaps the traffic split rather than partitioning it.
 */
export interface RelayServiceTotals {
  /** Hop streams opened **to** this node — someone using it as their relay. */
  readonly inboundHopStreams: number
  /** Hop streams **this node** opened — reserving on, or dialling through, another relay. */
  readonly outboundHopStreams: number
  /** Stop streams **this node** opened — delivering a relayed connection to a reserving peer. */
  readonly outboundStopStreams: number
  /** Stop streams opened **to** this node — a relay delivering a connection to it. */
  readonly inboundStopStreams: number
  /** Payload bytes on all four, both directions. Overlaps the traffic split — see the header. */
  readonly bytes: number
  /**
   * When the first inbound hop stream arrived, in ms since the epoch — or `undefined` if
   * this node has never been used as a relay.
   *
   * **Write-once.** Once set it is never moved, by an observation or by a restore, because
   * the question it answers is *when did this start* and a value that tracks the latest event
   * answers a different one. {@link RelayServiceLog.restore} keeps the earlier of the two.
   */
  readonly firstInboundHopStreamAt: number | undefined
}

/** A node that has neither relayed for anyone nor been relayed for. */
export const NO_RELAY_SERVICE: RelayServiceTotals = {
  inboundHopStreams: 0,
  outboundHopStreams: 0,
  outboundStopStreams: 0,
  inboundStopStreams: 0,
  bytes: 0,
  firstInboundHopStreamAt: undefined,
}

/** The four stream roles this log recognises, and the field each one increments. */
type RelayStreamRole =
  | 'inboundHopStreams'
  | 'outboundHopStreams'
  | 'outboundStopStreams'
  | 'inboundStopStreams'

function roleOf(stream: Stream): RelayStreamRole | undefined {
  const inbound = stream.direction === 'inbound'
  if (stream.protocol === RELAY_HOP_PROTOCOL) {
    return inbound ? 'inboundHopStreams' : 'outboundHopStreams'
  }
  if (stream.protocol === RELAY_STOP_PROTOCOL) {
    return inbound ? 'inboundStopStreams' : 'outboundStopStreams'
  }
  return undefined
}

/**
 * The relay-service record kept by one node about itself.
 *
 * Platform-free on purpose: this class knows nothing about Durable Objects, storage or
 * JSON. The hosted tier's `relay-service-journal.ts` is what makes the totals survive
 * eviction, and keeping the two apart is what lets the browser tier hold this same log
 * without inheriting a storage dependency it cannot satisfy.
 */
export class RelayServiceLog {
  readonly #counts: Record<RelayStreamRole, number> = {
    inboundHopStreams: 0,
    outboundHopStreams: 0,
    outboundStopStreams: 0,
    inboundStopStreams: 0,
  }
  #bytes = 0
  #firstInboundHopStreamAt: number | undefined
  #restored = false
  readonly #seen = new WeakSet<Stream>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /**
   * Whether this log has been given a starting point.
   *
   * The hosted tier reads it before banking: a log that was never restored holds only what
   * this instance saw, and writing that over a stored lifetime total would erase the history
   * the whole file exists to keep. The journal refuses such a write outright — this flag is
   * how a caller can avoid making it.
   */
  get restored(): boolean {
    return this.#restored
  }

  /**
   * Adopt a stored lifetime total as this log's starting point.
   *
   * Additive rather than replacing, so `restore` after an observation cannot lose the
   * observation — an instance that answered one request before its journal read completed is
   * the ordinary case on a Durable Object, not a corner one. The marker keeps whichever
   * timestamp is **earlier**, because it names a beginning.
   */
  restore(banked: RelayServiceTotals): void {
    this.#restored = true
    this.#counts.inboundHopStreams += banked.inboundHopStreams
    this.#counts.outboundHopStreams += banked.outboundHopStreams
    this.#counts.outboundStopStreams += banked.outboundStopStreams
    this.#counts.inboundStopStreams += banked.inboundStopStreams
    this.#bytes += banked.bytes
    const marker = banked.firstInboundHopStreamAt
    if (marker !== undefined) {
      this.#firstInboundHopStreamAt = Math.min(this.#firstInboundHopStreamAt ?? marker, marker)
    }
  }

  /**
   * Record one protocol stream, if it is one of the four this log is about.
   *
   * Streams on every other protocol are ignored — identify, ping, kad-dht and the fabric's
   * own protocols all pass through the same seam, and a log that counted them would be a
   * metrics backend rather than an answer to one question.
   *
   * **A stream is counted once.** libp2p hands the same object to
   * `trackProtocolStream` on the path that opens it, and the guard here means a second call
   * cannot double the count while still allowing the byte wrap to keep accruing.
   *
   * `send` and `onData` are wrapped on the instance for the reason `traffic-split.ts` gives
   * at length: `AbstractMessageStream` branches on `listenerCount('message')` when it
   * dispatches, so observing bytes by adding a listener would change how they are delivered.
   */
  observe(stream: Stream): void {
    const role = roleOf(stream)
    if (role === undefined) return
    if (this.#seen.has(stream)) return
    this.#seen.add(stream)

    this.#counts[role] += 1
    if (role === 'inboundHopStreams') {
      this.#firstInboundHopStreamAt ??= this.#now()
    }

    const send = stream.send.bind(stream)
    stream.send = (data) => {
      this.#bytes += data.byteLength
      return send(data)
    }
    // Narrowed rather than asserted, exactly as `TrafficSplitCounter.track` does it: `onData`
    // is on `AbstractMessageStream`, which every muxer in this stack extends, but it is not
    // on the public `Stream` type. A stream without it contributes outbound bytes only, which
    // is a stated half-count rather than a silent one.
    if (hasOnData(stream)) {
      const onData = stream.onData.bind(stream)
      stream.onData = (data: Uint8Array): void => {
        this.#bytes += data.byteLength
        onData(data)
      }
    }
  }

  /** The totals as they stand — what was restored plus what has been observed since. */
  report(): RelayServiceTotals {
    return {
      inboundHopStreams: this.#counts.inboundHopStreams,
      outboundHopStreams: this.#counts.outboundHopStreams,
      outboundStopStreams: this.#counts.outboundStopStreams,
      inboundStopStreams: this.#counts.inboundStopStreams,
      bytes: this.#bytes,
      firstInboundHopStreamAt: this.#firstInboundHopStreamAt,
    }
  }
}

/** The inbound-byte hook, present on every `AbstractMessageStream` and not on the interface. */
interface HasOnData {
  onData(data: Uint8Array): void
}

function hasOnData(stream: Stream): stream is Stream & HasOnData {
  return 'onData' in stream && typeof stream.onData === 'function'
}
