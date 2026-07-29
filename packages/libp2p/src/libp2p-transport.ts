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
 * ## libp2p v3
 *
 * v3 streams are `EventTarget`s: `.send(bytes)` returns `false` when the buffer is
 * full and `onDrain()` resolves when it is writable again. They are also
 * `AsyncIterable`, which is what the read path uses. Any v1/v2 example using
 * `.source` / `.sink` will not compile against this version.
 */

import { peerIdFromString } from '@libp2p/peer-id'
import type { Libp2p, Stream } from '@libp2p/interface'
import type { Transport } from '@o2/core'
import { MAX_INBOUND_MESSAGE_BYTES, WIRE_CHUNK_BYTES } from './constants.ts'

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
 */
class InboundTooLarge extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InboundTooLarge'
  }
}

async function readMessage(
  stream: Stream,
  max: number,
  from: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    // v3 yields `Uint8Array | Uint8ArrayList`; the list form is a rope over
    // several buffers and `subarray()` flattens it.
    const flat = chunk instanceof Uint8Array ? chunk : chunk.subarray()
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
}

export class Libp2pTransport implements Transport {
  readonly localId: string
  readonly #libp2p: Libp2p
  readonly #handlers = new Set<Handler>()
  readonly #sendTimeoutMs: number
  readonly #maxMessageBytes: number
  #refusedInbound = 0
  #stopped = false

  private constructor(libp2p: Libp2p, sendTimeoutMs: number, maxMessageBytes: number) {
    this.#libp2p = libp2p
    this.#sendTimeoutMs = sendTimeoutMs
    this.#maxMessageBytes = maxMessageBytes
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
    )

    await libp2p.handle(
      O2_RPC_PROTOCOL,
      async (stream, connection) => {
        const from = connection.remotePeer.toString()
        try {
          let message: Uint8Array<ArrayBuffer>
          try {
            message = await readMessage(stream, transport.#maxMessageBytes, from)
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
    const signal = AbortSignal.timeout(this.#sendTimeoutMs)
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

  /** Currently connected peers. Reflects live connections, not a static list. */
  get peers(): readonly string[] {
    return this.#libp2p.getPeers().map((peer) => peer.toString())
  }

  /** Deregister the protocol. Does not stop the underlying libp2p node. */
  async stop(): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    this.#handlers.clear()
    await this.#libp2p.unhandle(O2_RPC_PROTOCOL)
  }

  #dispatch(from: string, message: Uint8Array<ArrayBuffer>): void {
    // Snapshot: a handler may unsubscribe during delivery.
    for (const handler of [...this.#handlers]) handler(from, message)
  }
}
