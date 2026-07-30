/**
 * `Transport` over libp2p — the adapter this phase exists to prove.
 *
 * The kernel is unchanged by its arrival, which is the whole claim: `MemoryNetwork`
 * and this class implement the same three-member interface, and nothing above them
 * knows which one it has.
 *
 * ## One stream per message
 *
 * Each `send` opens a fresh stream, writes the message, and closes its write end.
 * The reader therefore knows a message is complete when the stream's readable end
 * ends — no length prefix, no framing state machine, no partial-message parsing.
 * Streams are cheap on an established connection (yamux multiplexes them), and the
 * alternative — a long-lived stream carrying delimited messages — buys throughput
 * at the cost of the exact framing bug class this design cannot have.
 *
 * Responses travel the same way, on a stream opened in the other direction over
 * the same connection, so `Transport` stays a one-way datagram port and
 * request/response correlation stays in `@o2/net` where it is transport-agnostic.
 *
 * NET-09 adds a per-destination gate over how many of those streams may be open at
 * once. That bounds *concurrency*; it does not reintroduce a framing state machine,
 * so the argument above stands unchanged — each message still gets a whole stream
 * to itself and still ends by closing the write end.
 *
 * ## No deadlock
 *
 * A reader will ask, so: the gate cannot block its own drain. `Transport` is a
 * one-way datagram port — `send` resolves when `stream.close()` completes, never on
 * a reply — and a reply travels on a stream opened in the *other* direction, which
 * passes through the *other* node's gate. The two gates are independent state, so a
 * full gate can delay a send but can never be waiting on something that is itself
 * waiting behind it.
 *
 * ## libp2p v3
 *
 * v3 streams are `EventTarget`s: `.send(bytes)` returns `false` when the buffer is
 * full and `onDrain()` resolves when it is writable again. They are also
 * `AsyncIterable`, which is what the read path uses. Any v1/v2 example using
 * `.source` / `.sink` will not compile against this version.
 */

import { peerIdFromString } from '@libp2p/peer-id'
import type { Libp2p, Stream } from '@libp2p/interface'
import { SendRefused } from '@o2/core'
import type { Transport } from '@o2/core'
import {
  MAX_CONCURRENT_STREAMS_PER_PEER,
  MAX_INBOUND_MESSAGE_BYTES,
  MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER,
  MAX_QUEUED_SENDS_PER_PEER,
  WIRE_CHUNK_BYTES,
} from './constants.ts'

/** The fabric's own protocol id, versioned so a later wire change is negotiable. */
export const O2_RPC_PROTOCOL = '/o2/rpc/1.0.0'

/** Default time a single message transfer may take before it is abandoned. */
export const DEFAULT_SEND_TIMEOUT_MS = 20_000

type Handler = (from: string, message: Uint8Array<ArrayBuffer>) => void

export interface Libp2pTransportOptions {
  readonly sendTimeoutMs?: number
  /**
   * Concurrent inbound streams permitted per connection.
   *
   * One stream per message means a job's shards and their block fetches are
   * concurrent streams, so the libp2p default of 32 is reachable with a modest
   * shard count. Exceeding it surfaces as reset streams under load — a failure
   * that looks like packet loss and is not.
   */
  readonly maxInboundStreams?: number
  readonly maxOutboundStreams?: number
  /**
   * NET-08 — largest single inbound message this transport will accumulate.
   *
   * Defaults to {@link MAX_INBOUND_MESSAGE_BYTES}. It exists as an option so a
   * test can shrink it to a few KiB and reproduce the abort in milliseconds
   * rather than shipping megabytes through a suite —
   * `packages/node/src/transport-bounds.node.test.ts` does exactly that, and then
   * proves separately that the shipped default is the enforced value and not only
   * the override.
   *
   * Plan 13.1-05 threads it from both node factories. Today neither passes
   * `Libp2pTransportOptions` at all (`fabric-node.ts` and `browser-node.ts` both
   * call `Libp2pTransport.start(libp2p)` bare), so this is the first option that
   * needs threading.
   */
  readonly maxMessageBytes?: number
  /**
   * NET-09 — outbound streams held open toward one peer at a time.
   *
   * Defaults to {@link MAX_CONCURRENT_STREAMS_PER_PEER}. It exists as an option so
   * a test can plant the mutation: setting it to 32 reproduces
   * `MaxEarlyStreamsError` on the *receiving* node's muxer, which is what proves
   * the gate is load-bearing rather than decorative.
   *
   * Plan 13.1-05 deliberately does **not** expose this knob on the node factories.
   * It is a protocol-safety bound sited against libp2p's own `maxEarlyStreams`, not
   * a deployment choice, and exposing it would invite somebody to raise it past 10
   * and reintroduce the cliff.
   */
  readonly maxConcurrentStreamsPerPeer?: number
  /**
   * NET-09 — sends allowed to wait behind the per-peer gate before one is refused.
   *
   * Defaults to {@link MAX_QUEUED_SENDS_PER_PEER}. A test overrides it low to reach
   * the refusal without dispatching hundreds of sends.
   */
  readonly maxQueuedSendsPerPeer?: number
}

/** One waiter parked behind a destination's gate. */
interface Waiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

/** Per-destination send state: streams in flight, plus everyone waiting for one. */
interface Gate {
  active: number
  readonly queue: Waiter[]
}

/**
 * The cap's own refusal, distinguishable from every other way a read can fail.
 *
 * Module-private on purpose: nothing outside needs to catch it, and the counter it
 * feeds is the public reading.
 */
class InboundTooLarge extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InboundTooLarge'
  }
}

/**
 * The accumulation budget's own refusal. Same shape, same reason, different question.
 *
 * `InboundTooLarge` says one message was too big. This says one peer is holding too
 * much at once while every message it sent was legal.
 */
class InboundOverBudget extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InboundOverBudget'
  }
}

/**
 * One `readMessage` call's claim on its peer's accumulation budget.
 *
 * Minted per call so the amount to give back is held by the caller that took it —
 * the same reasoning `EgressGuard`'s holds are values rather than a shared count.
 */
interface Budget {
  /** Take `bytes` against the peer's running total, or refuse the whole read. */
  charge(bytes: number): void
  /** Give back everything this call took, whatever exit path it is leaving by. */
  release(): void
}

/**
 * Collect one whole message from a stream that ends when the sender closes write.
 *
 * NET-08: `total` is bounded **during** accumulation. A cap applied after the loop
 * has already paid for the allocation it exists to prevent — the peer chose how
 * many chunks to send and how big the sum would be, and both `chunks` and the
 * `new Uint8Array(total)` below are that choice made concrete. Checking after the
 * fact would report the overrun having already suffered it, which is the whole
 * content of the requirement.
 *
 * `budget` is that same argument counted across every concurrent read from one peer.
 * A peer that never closes write holds its accumulation for as long as it likes, and
 * `max` alone bounds each of those and none of their sum.
 */
async function readMessage(
  stream: Stream,
  max: number,
  from: string,
  budget: Budget,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      // v3 yields `Uint8Array | Uint8ArrayList`; the list form is a rope over
      // several buffers and `subarray()` flattens it.
      const flat = chunk instanceof Uint8Array ? chunk : chunk.subarray()
      // Charged before the push, for the reason the docblock gives about `total`:
      // these bytes are retained from the next line onward.
      budget.charge(flat.byteLength)
      chunks.push(flat)
      total += flat.byteLength
      if (total > max) {
        // Named so an operator reads the refusal without a debugger: who sent it,
        // what the declared bound was, and how far the accumulation had got.
        const error = new InboundTooLarge(
          `inbound message from ${from} exceeds ${max} bytes (reached ${total}) — stream aborted`,
        )
        stream.abort(error)
        throw error
      }
    }
    const message = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      message.set(chunk, offset)
      offset += chunk.byteLength
    }
    return message
  } catch (cause) {
    // A peer told to stop is a peer that stops sending. Without this the refused
    // stream's unread bytes pile up in the muxer's own read buffer instead, which
    // moves the retention rather than bounding it.
    if (cause instanceof InboundOverBudget) stream.abort(cause)
    throw cause
  } finally {
    budget.release()
  }
}

export class Libp2pTransport implements Transport {
  readonly localId: string
  readonly #libp2p: Libp2p
  readonly #handlers = new Set<Handler>()
  readonly #sendTimeoutMs: number
  readonly #maxMessageBytes: number
  readonly #maxBacklogBytes: number
  readonly #maxStreamsPerPeer: number
  readonly #maxQueuedSends: number
  /** Live gates. An entry exists only while a destination has streams or waiters. */
  readonly #gates = new Map<string, Gate>()
  /** The instrument. Retained per destination — see {@link peakStreamsTo}. */
  readonly #peakStreams = new Map<string, number>()
  /** Bytes each peer is holding across its unfinished reads. Zero entries are dropped. */
  readonly #inboundBacklog = new Map<string, number>()
  #refusedInbound = 0
  #refusedOverBudget = 0
  #stopped = false

  private constructor(
    libp2p: Libp2p,
    sendTimeoutMs: number,
    maxMessageBytes: number,
    maxStreamsPerPeer: number,
    maxQueuedSends: number,
  ) {
    this.#libp2p = libp2p
    this.#sendTimeoutMs = sendTimeoutMs
    this.#maxMessageBytes = maxMessageBytes
    // Derived rather than declared, so shrinking the per-message cap shrinks the
    // budget with it and a budget below one legal message cannot be expressed.
    this.#maxBacklogBytes = maxMessageBytes * MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER
    this.#maxStreamsPerPeer = maxStreamsPerPeer
    this.#maxQueuedSends = maxQueuedSends
    this.localId = libp2p.peerId.toString()
  }

  /** Register the o2 protocol on a running libp2p node and return the port view. */
  static async start(
    libp2p: Libp2p,
    options: Libp2pTransportOptions = {},
  ): Promise<Libp2pTransport> {
    const transport = new Libp2pTransport(
      libp2p,
      options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS,
      options.maxMessageBytes ?? MAX_INBOUND_MESSAGE_BYTES,
      options.maxConcurrentStreamsPerPeer ?? MAX_CONCURRENT_STREAMS_PER_PEER,
      options.maxQueuedSendsPerPeer ?? MAX_QUEUED_SENDS_PER_PEER,
    )

    await libp2p.handle(
      O2_RPC_PROTOCOL,
      async (stream, connection) => {
        const from = connection.remotePeer.toString()
        try {
          let message: Uint8Array<ArrayBuffer>
          try {
            // Minted here because this is the only place the remote peer is known.
            message = await readMessage(
              stream,
              transport.#maxMessageBytes,
              from,
              transport.#budgetFor(from),
            )
          } catch (cause) {
            // NET-08: `readMessage` has already aborted the *stream*, and the
            // connection is expected to survive. Measured 2026-07-29 in
            // `transport-bounds.node.test.ts`: an in-limit message sent
            // immediately after a refusal is still delivered.
            //
            // This `catch` is here to make the refusal countable and to keep a
            // rejected handler promise out of libp2p's delivery path, **not**
            // because letting it escape kills the connection — that was checked by
            // replacing this body with a bare rethrow, and all three cases stayed
            // green.
            //
            // Only the cap's own refusal is counted. A peer that dies mid-message
            // also lands here, and counting that would make `refusedInbound` a
            // reading nobody could interpret.
            if (cause instanceof InboundTooLarge) transport.#refusedInbound += 1
            else if (cause instanceof InboundOverBudget) transport.#refusedOverBudget += 1
            return
          }
          transport.#dispatch(from, message)
        } finally {
          // Best effort: the peer may already have gone away, and a failure to
          // close a stream we are done with is not worth propagating.
          await stream.close().catch(() => {})
        }
      },
      {
        maxInboundStreams: options.maxInboundStreams ?? 256,
        maxOutboundStreams: options.maxOutboundStreams ?? 256,
        // Required for the protocol to negotiate at all over a relayed
        // connection. Without it a browser peer reached via /p2p-circuit can
        // connect and still fail to speak this protocol — a confusing failure
        // that costs more to diagnose later than to opt into now.
        runOnLimitedConnection: true,
      },
    )

    return transport
  }

  async send(to: string, message: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.#stopped) throw new Error('transport stopped')
    // Created **before** the gate is taken, deliberately. The bounded wait behind
    // the gate is part of what this send costs, so it has to sit inside the same
    // budget as the dial and the write — a signal created after the wait would
    // leave the queueing untimed and a saturated gate would look like a hang.
    const signal = AbortSignal.timeout(this.#sendTimeoutMs)
    await this.#acquire(to, signal)

    try {
      const stream = await this.#libp2p.dialProtocol(peerIdFromString(to), O2_RPC_PROTOCOL, {
        signal,
        runOnLimitedConnection: true,
      })

      try {
        for (let offset = 0; offset < message.byteLength; offset += WIRE_CHUNK_BYTES) {
          const chunk = message.subarray(offset, Math.min(offset + WIRE_CHUNK_BYTES, message.byteLength))
          if (!stream.send(chunk)) {
            // Buffer full — wait for it to drain rather than growing it without
            // bound. This is the one place backpressure has to be respected.
            await stream.onDrain({ signal })
          }
        }
        // Closing the write end is what tells the reader the message is complete.
        await stream.close({ signal })
      } catch (cause) {
        stream.abort(cause instanceof Error ? cause : new Error(String(cause)))
        throw cause
      }
    } finally {
      this.#release(to)
    }
  }

  /**
   * High-water mark of concurrently-open outbound streams toward `to`.
   *
   * Same reasoning as `LocalCapacity.peakInFlight`: a bound nobody can read is a
   * bound nobody can test. This is a reading of *concurrency* and must not be
   * reported as a bound on libp2p's cumulative `earlyStreams` count — see
   * {@link MAX_CONCURRENT_STREAMS_PER_PEER}.
   *
   * Unlike the gate entries, which are dropped as soon as a destination goes idle,
   * this map retains one integer per destination ever sent to. That is a deliberate
   * cost accepted for an instrument, not an oversight.
   */
  peakStreamsTo(to: string): number {
    return this.#peakStreams.get(to) ?? 0
  }

  onMessage(handler: Handler): () => void {
    this.#handlers.add(handler)
    return () => {
      this.#handlers.delete(handler)
    }
  }

  /**
   * NET-08 — inbound messages this node refused for exceeding its declared cap.
   *
   * The house style this project keeps returning to: `FetchingBlockstore.rejected`
   * is asserted in `fabric-node.node.test.ts` for the same reason. A guard that
   * silently starts refusing *everything* is indistinguishable from a quiet
   * network, and a counter is what makes the difference readable. It counts the
   * cap's refusals only — a peer that dies mid-message is not a refusal.
   */
  get refusedInbound(): number {
    return this.#refusedInbound
  }

  /**
   * NET-08 — reads this node refused because the peer was already holding too much.
   *
   * A **different question** from {@link refusedInbound}, kept as a second number
   * because the two lead to different actions: that one says a peer sent one message
   * that was too big, this one says a peer is holding too many legal messages
   * unfinished at once. Summing them would produce a reading nobody could act on.
   */
  get refusedOverBudget(): number {
    return this.#refusedOverBudget
  }

  /** Currently connected peers. Reflects live connections, not a static list. */
  get peers(): readonly string[] {
    return this.#libp2p.getPeers().map((peer) => peer.toString())
  }

  /** Deregister the protocol. Does not stop the underlying libp2p node. */
  async stop(): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    this.#handlers.clear()
    // A send parked behind the gate would otherwise hang until its own timeout,
    // which is a shutdown that looks like a stall. It rejects with the same error
    // `send` raises when called after `stop` — not with `SendRefused`, because a
    // shutdown is not this node's admission bound refusing.
    for (const gate of this.#gates.values()) {
      for (const waiter of gate.queue.splice(0)) waiter.reject(new Error('transport stopped'))
    }
    this.#gates.clear()
    // Unlike `#peakStreams`, which is keyed on destinations this node chose to dial
    // and is deliberately retained as an instrument, this map is keyed on peer ids an
    // attacker mints. Retaining it would be a second, quieter unbounded growth.
    this.#inboundBacklog.clear()
    await this.#libp2p.unhandle(O2_RPC_PROTOCOL)
  }

  /** This peer's claim on the accumulation budget, for the lifetime of one read. */
  #budgetFor(peer: string): Budget {
    const backlog = this.#inboundBacklog
    const ceiling = this.#maxBacklogBytes
    let held = 0
    return {
      charge(bytes: number): void {
        const running = (backlog.get(peer) ?? 0) + bytes
        if (running > ceiling) {
          throw new InboundOverBudget(
            `inbound accumulation from ${peer} exceeds ${ceiling} bytes (reached ${running}) — stream aborted`,
          )
        }
        backlog.set(peer, running)
        held += bytes
      },
      release(): void {
        const remaining = (backlog.get(peer) ?? 0) - held
        if (remaining > 0) backlog.set(peer, remaining)
        else backlog.delete(peer)
        held = 0
      },
    }
  }

  #dispatch(from: string, message: Uint8Array<ArrayBuffer>): void {
    // Snapshot: a handler may unsubscribe during delivery.
    for (const handler of [...this.#handlers]) handler(from, message)
  }

  /**
   * Take one of this destination's stream slots, waiting FIFO if none is free.
   *
   * Refuses immediately — with a {@link SendRefused}, not by waiting — once the
   * queue is at its bound. A caller that is going to be turned away is better off
   * learning at once: a refusal it can act on beats latency it cannot distinguish
   * from a slow peer.
   */
  async #acquire(to: string, signal: AbortSignal): Promise<void> {
    let gate = this.#gates.get(to)
    if (gate === undefined) {
      gate = { active: 0, queue: [] }
      this.#gates.set(to, gate)
    }

    if (gate.active < this.#maxStreamsPerPeer) {
      gate.active += 1
      this.#recordPeak(to, gate.active)
      return
    }

    if (gate.queue.length >= this.#maxQueuedSends) {
      throw new SendRefused(
        `${this.localId} refused a send to ${to}: ${gate.active} of ${this.#maxStreamsPerPeer} ` +
          `streams in use and ${gate.queue.length} of ${this.#maxQueuedSends} sends queued`,
        { to, by: this.localId },
      )
    }

    const queue = gate.queue
    await new Promise<void>((resolve, reject) => {
      let waiter: Waiter | null = null
      const onAbort = (): void => {
        if (waiter !== null) {
          const at = queue.indexOf(waiter)
          if (at !== -1) queue.splice(at, 1)
        }
        // A timeout and a shutdown are not this node's admission bound refusing,
        // so they reject with the ordinary errors they already reject with —
        // never with `SendRefused`.
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      waiter = {
        resolve: () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        },
        reject: (error: Error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      }
      queue.push(waiter)
    })
  }

  /** Give the slot back — to the next waiter if there is one, otherwise to the pool. */
  #release(to: string): void {
    const gate = this.#gates.get(to)
    if (gate === undefined) return
    const next = gate.queue.shift()
    if (next !== undefined) {
      // The slot transfers straight to the waiter, so `active` is unchanged. The
      // peak is re-recorded rather than assumed: the transfer keeps concurrency at
      // its current level, and an instrument that only reads on the increment path
      // would be silent for the whole drain.
      this.#recordPeak(to, gate.active)
      next.resolve()
      return
    }
    gate.active -= 1
    if (gate.active <= 0) this.#gates.delete(to)
  }

  #recordPeak(to: string, active: number): void {
    const seen = this.#peakStreams.get(to) ?? 0
    if (active > seen) this.#peakStreams.set(to, active)
  }
}
