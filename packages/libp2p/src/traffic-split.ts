/**
 * NET-14 — how much of this fabric's traffic is peer-to-peer, and how much goes through a
 * relay.
 *
 * ## Why this is structural rather than instrumentation polish
 *
 * A hosted-relay fabric becoming hosted-in-practice while every document still calls it
 * peer-to-peer is the **median** outcome, not a tail case: IPFS's measured cloud reliance
 * (arXiv:2309.16203) and Matrix's homeserver dominance are the two precedents the roadmap
 * names. Nothing about that drift is visible from inside — every individual connection
 * works. What makes it visible is a number that separates the two, reported from before
 * the relay carries its first browser.
 *
 * ## The classification trap, which is the one thing here that had to be got right
 *
 * A browser's **direct** WebRTC address has the real form
 * `<relay>/p2p-circuit/webrtc/p2p/<self>` — the relay portion is the signalling path, and it
 * is still in the string long after the relay has left the data path. `Circuit.matches`
 * reads that as relayed. So a classifier written in the obvious order — circuit first —
 * reports **every direct browser-to-browser connection as relayed**, which is precisely the
 * false reading this requirement exists to prevent, manufactured by the counter itself.
 *
 * **MEASURED 2026-08-30, and the trap is not where it was expected to be.** Against this
 * repository's `@multiformats/multiaddr-matcher@3.0.2`, `Circuit.matches` answers **false**
 * for `/ip4/…/tls/ws/p2p/<relay>/p2p-circuit/webrtc/p2p/<self>` and `WebRTC.matches` answers
 * true — the library already disambiguates, and a circuit-first classifier would have
 * answered `direct` too. So the order below is **not load-bearing today**, and saying so is
 * the point: swapping the two branches leaves `traffic-split.test.ts` green, which is a
 * plant that cannot fail and would be worse than no plant if it were left unrecorded.
 *
 * What keeps the property checked is a case that pins the *library's* answer rather than
 * this function's — if a future matcher version starts matching the form as a circuit, that
 * case goes red and this ordering becomes the thing standing between the fabric and a
 * counter that reports every direct browser pair as relayed.
 *
 * The order is kept WebRTC-first anyway, because it states the intent that survives a
 * library change: what decides the column is where the **bytes** go, and a WebRTC connection
 * carries them directly however its address was negotiated.
 *
 * ## Why bytes are counted at `trackMultiaddrConnection` and not at a transport
 *
 * It is the one seam every transport passes through — `libp2p/dist/src/upgrader.js:140`
 * calls it on every upgrade, inbound and outbound, before encryption and muxing. Counting
 * inside a transport would count one transport; counting per protocol stream would miss the
 * handshake bytes that a relayed connection also pays for.
 *
 * ## Why a still-open connection is measured at read time rather than at close
 *
 * A counter that only learns of a connection when it closes reports zero for a fabric whose
 * connections are all still up — which is every fabric that is working. {@link
 * TrafficSplitCounter.report} therefore adds `now - openedAt` for each live connection to the
 * total already banked from closed ones. That also means the counter does not depend on
 * observing every close, which on a tab that is killed is not observable at all.
 */

import { Circuit, WebRTC, WebRTCDirect } from '@multiformats/multiaddr-matcher'
import type { RelayServiceLog } from './relay-service-log.ts'
import type { Multiaddr } from '@multiformats/multiaddr'
import type {
  Counter,
  CounterGroup,
  Histogram,
  HistogramGroup,
  Metric,
  MetricGroup,
  Metrics,
  MultiaddrConnection,
  Stream,
  Summary,
  SummaryGroup,
} from '@libp2p/interface'

/** Which side of the split a connection falls on. */
export type ConnectionClass = 'direct' | 'relayed'

/**
 * Classify one connection's address.
 *
 * **WebRTC first.** See the file header: a direct WebRTC connection's address still names
 * the relay that signalled it, so asking `Circuit` first answers `relayed` for the very
 * connections this counter exists to show are not.
 */
export function classifyConnection(address: Multiaddr): ConnectionClass {
  if (WebRTC.matches(address) || WebRTCDirect.matches(address)) return 'direct'
  if (Circuit.matches(address)) return 'relayed'
  return 'direct'
}

/** One side of the split. */
export interface TrafficLeg {
  /** Summed connection lifetimes, in seconds. */
  readonly connectionSeconds: number
  /** Bytes carried in both directions. */
  readonly bytes: number
}

/** What {@link TrafficSplitCounter.report} answers. */
export interface TrafficSplit {
  readonly direct: TrafficLeg
  readonly relayed: TrafficLeg
}

interface LiveConnection {
  readonly kind: ConnectionClass
  readonly openedAt: number
  bytes: number
}

/**
 * The two counters, kept by a node about its own connections.
 *
 * Not a `Metrics` implementation itself — {@link trafficSplitMetrics} adapts it to that
 * interface. The split keeps this class testable without a network stack, which is what
 * lets the classification cases run in the unit lane.
 */
export class TrafficSplitCounter {
  readonly #live = new Map<MultiaddrConnection, LiveConnection>()
  readonly #banked: Record<ConnectionClass, { ms: number; bytes: number }> = {
    direct: { ms: 0, bytes: 0 },
    relayed: { ms: 0, bytes: 0 },
  }
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /**
   * Start counting one connection.
   *
   * **`send` and `onData` are replaced on the instance rather than a `'message'` listener
   * being added, and that is not a style choice.** `AbstractMessageStream` branches on
   * `listenerCount('message')` when it dispatches (`abstract-message-stream.js:187,205`), so
   * adding a listener to observe bytes would change how the stream delivers them. Wrapping
   * the two methods that carry bytes calls through unchanged and observes only.
   */
  track(connection: MultiaddrConnection): void {
    if (this.#live.has(connection)) return
    const entry: LiveConnection = {
      kind: classifyConnection(connection.remoteAddr),
      openedAt: this.#now(),
      bytes: 0,
    }
    this.#live.set(connection, entry)

    const send = connection.send.bind(connection)
    connection.send = (data) => {
      entry.bytes += data.byteLength
      return send(data)
    }
    // `onData` is how a transport pushes INBOUND bytes into the stream. It is on
    // `AbstractMessageStream`, which every transport in this stack extends, but not on the
    // public `MultiaddrConnection` type — so it is narrowed rather than assumed, and a
    // connection without it simply contributes outbound bytes only. Stating that here
    // rather than asserting the method into existence: a silent half-count is the kind of
    // number this file exists to stop.
    if (hasOnData(connection)) {
      const onData = connection.onData.bind(connection)
      connection.onData = (data: Uint8Array): void => {
        entry.bytes += data.byteLength
        onData(data)
      }
    }

    connection.addEventListener('close', () => {
      this.#bank(connection)
    })
  }

  #bank(connection: MultiaddrConnection): void {
    const entry = this.#live.get(connection)
    if (entry === undefined) return
    this.#live.delete(connection)
    const leg = this.#banked[entry.kind]
    leg.ms += this.#now() - entry.openedAt
    leg.bytes += entry.bytes
  }

  /**
   * The split as it stands, closed connections plus the ones still open.
   *
   * Seconds rather than milliseconds because the number is read by people: a fabric's
   * relayed share is a ratio, and the unit that makes the ratio legible is the one the
   * requirement names.
   */
  report(): TrafficSplit {
    const at = this.#now()
    const totals: Record<ConnectionClass, { ms: number; bytes: number }> = {
      direct: { ...this.#banked.direct },
      relayed: { ...this.#banked.relayed },
    }
    for (const entry of this.#live.values()) {
      const leg = totals[entry.kind]
      leg.ms += at - entry.openedAt
      leg.bytes += entry.bytes
    }
    return {
      direct: { connectionSeconds: totals.direct.ms / 1000, bytes: totals.direct.bytes },
      relayed: { connectionSeconds: totals.relayed.ms / 1000, bytes: totals.relayed.bytes },
    }
  }
}

/** The inbound-byte hook, present on every `AbstractMessageStream` and not on the interface. */
interface HasOnData {
  onData(data: Uint8Array): void
}

function hasOnData(connection: MultiaddrConnection): connection is MultiaddrConnection & HasOnData {
  return 'onData' in connection && typeof connection.onData === 'function'
}

/** A metric that records nothing — see {@link trafficSplitMetrics}. */
const inertMetric: Metric & Counter = {
  update: () => {},
  increment: () => {},
  decrement: () => {},
  reset: () => {},
  timer: () => () => {},
}

const inertGroup: MetricGroup & CounterGroup = {
  update: () => {},
  increment: () => {},
  decrement: () => {},
  reset: () => {},
  timer: () => () => {},
}

const inertHistogram: Histogram & Summary = {
  observe: () => {},
  reset: () => {},
  timer: () => () => {},
}

const inertHistogramGroup: HistogramGroup & SummaryGroup = {
  observe: () => {},
  reset: () => {},
  timer: () => () => {},
}

/**
 * Adapt a {@link TrafficSplitCounter} to libp2p's `Metrics` component.
 *
 * **Every `register*` member answers an inert metric, deliberately.** Supplying a `metrics`
 * component makes libp2p and every service on it start registering — identify, kad-dht,
 * the connection manager — and each expects an object back. Answering inert ones keeps this
 * seam about the two counters NET-14 asks for rather than turning it into a metrics backend
 * this project has no use for and would have to keep working.
 *
 * **`trackProtocolStream` was inert too, and stopped being so on 2026-08-30.** The reason it
 * was inert still stands and is not the reason it changed: *the handshake bytes a relayed
 * connection pays for are not on any protocol stream, so counting streams would undercount
 * exactly the traffic this requirement is about.* That is why the stream reading is NOT folded
 * into the split's two columns. It is a **third, separate** reading answering a different
 * question — what this node has done as a relay — and it is optional, so a caller that does
 * not pass a `relay` log gets exactly the previous behaviour. See `relay-service-log.ts` for
 * why the two numbers overlap and must not be reconciled by subtraction.
 */
export function trafficSplitMetrics(counter: TrafficSplitCounter, relay?: RelayServiceLog): Metrics {
  return {
    trackMultiaddrConnection: (connection: MultiaddrConnection): void => {
      counter.track(connection)
    },
    trackProtocolStream: (stream: Stream): void => {
      relay?.observe(stream)
    },
    registerMetric: () => inertMetric,
    registerMetricGroup: () => inertGroup,
    registerCounter: () => inertMetric,
    registerCounterGroup: () => inertGroup,
    registerHistogram: () => inertHistogram,
    registerHistogramGroup: () => inertHistogramGroup,
    registerSummary: () => inertHistogram,
    registerSummaryGroup: () => inertHistogramGroup,
    // Tracing is a no-op here: the function is handed back unchanged, which is what an
    // untraced build does anyway.
    traceFunction: <F>(_name: string, fn: F): F => fn,
    createTrace: () => undefined,
  }
}
