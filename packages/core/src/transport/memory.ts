/**
 * In-process transport — the loopback adapter behind the `Transport` port.
 *
 * No sockets, no ports, no async scheduling surprises: messages are delivered
 * through a shared routing table. Phase 2 swaps a libp2p adapter in behind the
 * same interface, and the kernel does not change — that swap is the point of the
 * port existing at all.
 *
 * Useful beyond tests: 100+ nodes in one process with deterministic delivery is
 * how the scheduler and reduce-tree logic get exercised without a network in the
 * way.
 */

import type { Transport } from '../ports.ts'

type Handler = (from: string, message: Uint8Array<ArrayBuffer>) => void

export type SendError =
  | { kind: 'unknown-peer'; to: string }
  | { kind: 'peer-unreachable'; to: string }

/** Thrown by `send` only for programming errors; delivery failures are returned. */
export class TransportError extends Error {
  readonly detail: SendError
  constructor(detail: SendError) {
    super(detail.kind === 'unknown-peer' ? `unknown peer: ${detail.to}` : `unreachable: ${detail.to}`)
    this.name = 'TransportError'
    this.detail = detail
  }
}

/**
 * A shared in-process network. Create one, then `connect()` a node per peer.
 */
export class MemoryNetwork {
  readonly #handlers = new Map<string, Set<Handler>>()
  /** Peers that have been partitioned off, to exercise churn and failure paths. */
  readonly #unreachable = new Set<string>()
  #delivered = 0

  /** Register a node and get its transport view. */
  connect(localId: string): Transport {
    if (this.#handlers.has(localId)) {
      throw new Error(`peer already connected: ${localId}`)
    }
    this.#handlers.set(localId, new Set())
    return new MemoryTransport(localId, this)
  }

  /** Remove a node entirely — subsequent sends to it report `unknown-peer`. */
  disconnect(localId: string): void {
    this.#handlers.delete(localId)
    this.#unreachable.delete(localId)
  }

  /** Keep the peer registered but make delivery fail, simulating a dead link. */
  partition(localId: string): void {
    this.#unreachable.add(localId)
  }

  heal(localId: string): void {
    this.#unreachable.delete(localId)
  }

  get peers(): readonly string[] {
    return [...this.#handlers.keys()]
  }

  /** Total messages successfully delivered — a cheap assertion target for tests. */
  get delivered(): number {
    return this.#delivered
  }

  /** @internal */
  register(localId: string, handler: Handler): () => void {
    const set = this.#handlers.get(localId)
    if (set === undefined) throw new Error(`peer not connected: ${localId}`)
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  /** @internal */
  route(from: string, to: string, message: Uint8Array<ArrayBuffer>): void {
    const handlers = this.#handlers.get(to)
    if (handlers === undefined) throw new TransportError({ kind: 'unknown-peer', to })
    if (this.#unreachable.has(to)) throw new TransportError({ kind: 'peer-unreachable', to })
    this.#delivered += 1
    // Copy per recipient. A real transport serializes, so handing over a view into
    // the sender's buffer would let the loopback path pass where a network would
    // not — the adapter must not be more permissive than what it stands in for.
    for (const handler of [...handlers]) {
      handler(from, message.slice())
    }
  }
}

class MemoryTransport implements Transport {
  readonly localId: string
  readonly #network: MemoryNetwork

  constructor(localId: string, network: MemoryNetwork) {
    this.localId = localId
    this.#network = network
  }

  async send(to: string, message: Uint8Array<ArrayBuffer>): Promise<void> {
    this.#network.route(this.localId, to, message)
  }

  onMessage(handler: Handler): () => void {
    return this.#network.register(this.localId, handler)
  }

  get peers(): readonly string[] {
    return this.#network.peers.filter((p) => p !== this.localId)
  }
}
