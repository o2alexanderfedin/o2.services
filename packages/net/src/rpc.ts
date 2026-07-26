/**
 * Request/response correlation over the one-way `Transport` port.
 *
 * `Transport` is deliberately a datagram shape — `send(to, bytes)` plus an
 * `onMessage` callback — because that is the smallest thing every candidate
 * transport can implement. Request/response is built on top rather than baked in,
 * which keeps the port implementable by an in-process routing table, a libp2p
 * stream, and (in a later phase) a relayed WebRTC channel without any of them
 * needing to know what a "reply" is.
 *
 * Correlation is by a locally-issued id. Two endpoints can both issue id 1
 * concurrently without conflict: a response is only ever matched against the
 * issuing endpoint's own pending table, so the id namespace is per-direction.
 *
 * Pure module — no platform imports beyond timers, which exist identically in
 * Node, a browser, and a Worker.
 */

import { decodeCanonical, encodeCanonical } from '@o2/core'
import type { CanonicalValue, Transport } from '@o2/core'

/** Default time a request waits before giving up. */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000

export type RpcError =
  | { readonly kind: 'timeout'; readonly to: string; readonly afterMs: number }
  | { readonly kind: 'send-failed'; readonly to: string; readonly detail: string }
  | { readonly kind: 'closed' }
  | { readonly kind: 'undecodable'; readonly from: string; readonly detail: string }

/** Thrown by `request`. Carries a typed detail so callers can branch without string matching. */
export class RpcFailure extends Error {
  readonly detail: RpcError
  constructor(detail: RpcError) {
    super(describe(detail))
    this.name = 'RpcFailure'
    this.detail = detail
  }
}

function describe(e: RpcError): string {
  switch (e.kind) {
    case 'timeout':
      return `rpc to ${e.to} timed out after ${e.afterMs}ms`
    case 'send-failed':
      return `rpc send to ${e.to} failed: ${e.detail}`
    case 'closed':
      return 'rpc endpoint closed'
    case 'undecodable':
      return `undecodable rpc frame from ${e.from}: ${e.detail}`
  }
}

/** Serves an inbound request body and produces the reply body. */
export interface RpcHandler {
  (from: string, body: CanonicalValue): Promise<CanonicalValue>
}

interface Pending {
  readonly resolve: (body: CanonicalValue) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface RpcEndpointOptions {
  readonly timeoutMs?: number
}

/**
 * One node's RPC endpoint. Construct over a `Transport`, optionally `serve` a
 * handler, and `close` when done.
 */
export class RpcEndpoint {
  readonly #transport: Transport
  readonly #pending = new Map<number, Pending>()
  readonly #timeoutMs: number
  readonly #unsubscribe: () => void
  #handler: RpcHandler | null = null
  #nextId = 1
  #closed = false

  constructor(transport: Transport, options: RpcEndpointOptions = {}) {
    this.#transport = transport
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
    this.#unsubscribe = transport.onMessage((from, message) => {
      void this.#receive(from, message)
    })
  }

  get localId(): string {
    return this.#transport.localId
  }

  /** Install the handler for inbound requests. Replaces any previous handler. */
  serve(handler: RpcHandler): void {
    this.#handler = handler
  }

  /** Send a request and await its reply. */
  async request(to: string, body: CanonicalValue): Promise<CanonicalValue> {
    if (this.#closed) throw new RpcFailure({ kind: 'closed' })
    const id = this.#nextId++
    const frame = this.#encode({ k: 'req', id, body })

    return new Promise<CanonicalValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new RpcFailure({ kind: 'timeout', to, afterMs: this.#timeoutMs }))
      }, this.#timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })

      // Register the pending entry *before* sending, so a synchronous in-process
      // transport that delivers the reply during `send` still finds it.
      this.#transport.send(to, frame).catch((cause: unknown) => {
        const entry = this.#pending.get(id)
        if (entry === undefined) return
        this.#pending.delete(id)
        clearTimeout(entry.timer)
        reject(
          new RpcFailure({
            kind: 'send-failed',
            to,
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
        )
      })
    })
  }

  /** Reject every in-flight request and stop listening. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#unsubscribe()
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer)
      entry.reject(new RpcFailure({ kind: 'closed' }))
    }
    this.#pending.clear()
  }

  #encode(frame: { k: 'req' | 'res'; id: number; body: CanonicalValue }): Uint8Array<ArrayBuffer> {
    const encoded = encodeCanonical(frame)
    if (!encoded.ok) {
      // A control frame that cannot be encoded is a programming error in this
      // package, not a peer's fault — fail loudly rather than send a partial frame.
      throw new Error(`rpc frame not encodable: ${JSON.stringify(encoded.error)}`)
    }
    return encoded.bytes
  }

  async #receive(from: string, message: Uint8Array<ArrayBuffer>): Promise<void> {
    let frame: CanonicalValue
    try {
      frame = decodeCanonical(message)
    } catch {
      // A peer that sends garbage is ignored, not allowed to throw inside the
      // transport's delivery loop.
      return
    }
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) return
    const record = frame as { readonly [k: string]: CanonicalValue }
    const id = record['id']
    const kind = record['k']
    if (typeof id !== 'number' || !Number.isInteger(id)) return
    const body = record['body']
    if (body === undefined) return

    if (kind === 'res') {
      const entry = this.#pending.get(id)
      if (entry === undefined) return // late or duplicate reply
      this.#pending.delete(id)
      clearTimeout(entry.timer)
      entry.resolve(body)
      return
    }

    if (kind !== 'req') return
    const handler = this.#handler
    if (handler === null) return

    let reply: CanonicalValue
    try {
      reply = await handler(from, body)
    } catch (cause) {
      reply = { error: cause instanceof Error ? cause.message : String(cause) }
    }
    if (this.#closed) return
    try {
      await this.#transport.send(from, this.#encode({ k: 'res', id, body: reply }))
    } catch {
      // The requester will time out. Nothing useful to do here — and throwing
      // would surface inside the transport's delivery path.
    }
  }
}
