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

/**
 * A reply body plus work that must not happen until the frame has settled.
 *
 * The one caller that needs this is `serveAgent`'s exec branch, which holds a
 * sovereign task's registration on the node's egress tap. That registration exists
 * to be scanned against the reply frame, so releasing it anywhere inside the handler
 * — where the guard and the label are both already in scope — would release it a
 * full frame too early and the reply would go out unscanned. `serveAgent` is the
 * only layer that knows *what* to release; this one is the only layer that knows
 * *when*. Hence the split.
 *
 * **The discriminator is safe by construction.** `CanonicalValue` is the
 * canonically-encodable set — records, arrays, strings, numbers, booleans, null,
 * `Uint8Array`, `CID` — and none of those can be a function. So
 * `typeof value.afterSent === 'function'` cannot collide with a legitimate reply
 * body, whatever a handler returns.
 *
 * **`afterSent` must not throw.** It runs inside the transport's delivery path, and
 * this module deliberately does not wrap it in a swallow: a swallow here would hide
 * a real fault in a callback that is supposed to be a `Map` delete behind a check.
 */
export interface RpcReply {
  readonly body: CanonicalValue
  /**
   * Invoked at most once, after the response frame has settled — sent, refused, or
   * abandoned because the endpoint closed. See {@link RpcReply}.
   */
  readonly afterSent: () => void
}

/**
 * Serves an inbound request body and produces the reply body.
 *
 * Returning a plain `CanonicalValue` is the ordinary case and needs nothing extra.
 * Returning an {@link RpcReply} additionally schedules a callback for after the
 * frame has left.
 */
export interface RpcHandler {
  (from: string, body: CanonicalValue): Promise<CanonicalValue | RpcReply>
}

/** Split a handler's result into the body to send and the callback to run after. */
function unwrapReply(value: CanonicalValue | RpcReply): {
  readonly body: CanonicalValue
  readonly afterSent: (() => void) | null
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { body: value as CanonicalValue, afterSent: null }
  }
  const candidate = value as { readonly afterSent?: unknown; readonly body?: unknown }
  if (typeof candidate.afterSent !== 'function') {
    return { body: value as CanonicalValue, afterSent: null }
  }
  return { body: (value as RpcReply).body, afterSent: (value as RpcReply).afterSent }
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

    let result: CanonicalValue | RpcReply
    try {
      result = await handler(from, body)
    } catch (cause) {
      result = { error: cause instanceof Error ? cause.message : String(cause) }
    }
    const { body: reply, afterSent } = unwrapReply(result)
    // The `finally` exists for three exits, and all three are exits the frame has
    // settled on: the send succeeded, the send was refused by this node's own
    // egress tap, and the endpoint closed between the handler returning and the
    // frame going out. The `#closed` check therefore lives *inside* the `try`
    // rather than as a bare return above it — a registration that leaked whenever
    // an endpoint closed mid-reply would be the same unbounded growth with a rarer
    // trigger.
    //
    // This module deliberately does not know what `afterSent` does. The layer that
    // knows the label is `serveAgent`; the layer that knows the frame has settled
    // is this one. Neither can do the other's half.
    try {
      if (this.#closed) return
      await this.#transport.send(from, this.#encode({ k: 'res', id, body: reply }))
    } catch {
      // The requester will time out. Nothing useful to do here — and throwing
      // would surface inside the transport's delivery path.
    } finally {
      afterSent?.()
    }
  }
}
