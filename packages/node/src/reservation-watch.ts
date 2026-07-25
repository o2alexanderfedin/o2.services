/**
 * NET-05, the joining node's side: turn a relay refusal into a named condition.
 *
 * ## Why this is needed
 *
 * A reservation is made by libp2p's own internal reservation store, on `listen`,
 * inside a retry loop. When a relay is full it responds with the Circuit Relay v2
 * status `RESERVATION_REFUSED`, and libp2p reports that as:
 *
 *     throw new Error(`reservation failed with status ${response.status}`)
 *
 * — an untyped `Error` with the status only in its message, thrown where no caller
 * can catch it. From the outside all the joining node observes is that no
 * `/p2p-circuit` address ever appeared, which is exactly what an unreachable relay
 * looks like. The two demand opposite responses: try a different relay, versus wait
 * and retry this one.
 *
 * ## Why a logger and not a reimplementation
 *
 * Speaking HOP RESERVE directly would mean reimplementing the protocol libp2p
 * already implements — the mistake this project has paid for once already. Instead
 * this observes libp2p's *own* reported status through the `logger` injection point
 * the library provides for the purpose.
 *
 * The cost is a dependency on an error string. That is made safe by pinning it:
 * `relay.node.test.ts` asserts the exact template still exists in the installed
 * package, so an upgrade that rewords it fails loudly at test time instead of
 * silently degrading to "unknown failure". Same discipline as the NET-07 constants.
 */

import { defaultLogger } from '@libp2p/logger'
import type { ComponentLogger, Logger } from '@libp2p/interface'

/**
 * The message template libp2p uses to report a failed reservation.
 *
 * Pinned by a test against the installed source. Not a guess.
 */
export const RESERVATION_FAILURE_PREFIX = 'reservation failed with status'

/** The Circuit Relay v2 status a relay returns when it has no free slots. */
export const STATUS_RESERVATION_REFUSED = 'RESERVATION_REFUSED'

/** The status a relay returns when it declines to serve this peer at all. */
export const STATUS_PERMISSION_DENIED = 'PERMISSION_DENIED'

export type ReservationFailure =
  /** The relay is full. Try another relay; this one may free up later. */
  | { readonly kind: 'at-capacity'; readonly status: string }
  /** The relay refuses this peer. Trying again will not help. */
  | { readonly kind: 'refused'; readonly status: string }
  /** Some other protocol status. Reported by name rather than swallowed. */
  | { readonly kind: 'protocol-error'; readonly status: string }

/**
 * Classify a reported reservation-failure message.
 *
 * Returns `null` for anything that is not a reservation failure, so it can be
 * applied to every log line cheaply.
 */
export function classifyReservationFailure(message: string): ReservationFailure | null {
  const at = message.indexOf(RESERVATION_FAILURE_PREFIX)
  if (at === -1) return null

  const status = message.slice(at + RESERVATION_FAILURE_PREFIX.length).trim()
  if (status.includes(STATUS_RESERVATION_REFUSED)) {
    return { kind: 'at-capacity', status: STATUS_RESERVATION_REFUSED }
  }
  if (status.includes(STATUS_PERMISSION_DENIED)) {
    return { kind: 'refused', status: STATUS_PERMISSION_DENIED }
  }
  return { kind: 'protocol-error', status: status === '' ? 'unknown' : status }
}

/** Formats one argument the way a printf-style logger would. */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
  return String(value)
}

/**
 * A `ComponentLogger` that watches for reservation failures and reports them by
 * name, while forwarding everything to an optional delegate.
 *
 * Install via `createLibp2p({ logger: watcher.logger })`.
 */
export class ReservationWatcher {
  readonly #failures: ReservationFailure[] = []
  readonly #listeners = new Set<(failure: ReservationFailure) => void>()
  readonly #delegate: ComponentLogger | undefined

  constructor(delegate?: ComponentLogger) {
    this.#delegate = delegate
  }

  /** Every failure observed so far, in order. */
  get failures(): readonly ReservationFailure[] {
    return this.#failures
  }

  /** True once a relay has reported itself full to this node. */
  get sawCapacityRefusal(): boolean {
    return this.#failures.some((f) => f.kind === 'at-capacity')
  }

  /** Subscribe to failures as they are reported. Returns an unsubscribe function. */
  onFailure(listener: (failure: ReservationFailure) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Wait for the next capacity refusal, or resolve `null` on timeout. */
  async nextCapacityRefusal(timeoutMs: number): Promise<ReservationFailure | null> {
    const existing = this.#failures.find((f) => f.kind === 'at-capacity')
    if (existing !== undefined) return existing

    return new Promise<ReservationFailure | null>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe()
        resolve(null)
      }, timeoutMs)
      const unsubscribe = this.onFailure((failure) => {
        if (failure.kind !== 'at-capacity') return
        clearTimeout(timer)
        unsubscribe()
        resolve(failure)
      })
    })
  }

  /**
   * The `ComponentLogger` to hand to `createLibp2p`.
   *
   * Wraps a real logger from `@libp2p/logger` in a `Proxy` rather than
   * implementing `Logger` by hand. The interface has members beyond the obvious
   * ones — `newScope`, which libp2p calls on the connection logger during every
   * upgrade — and a hand-written stand-in that omits one crashes the dial with
   * `log.newScope is not a function`. Proxying forwards everything, including
   * members added by future releases, and `newScope` returns a wrapped logger so
   * nested scopes stay observed.
   */
  get logger(): ComponentLogger {
    const observe = (args: readonly unknown[]): void => {
      const message = args.map(stringify).join(' ')
      const failure = classifyReservationFailure(message)
      if (failure === null) return
      this.#failures.push(failure)
      for (const listener of [...this.#listeners]) listener(failure)
    }

    const base = this.#delegate ?? defaultLogger()

    const wrap = (inner: Logger): Logger =>
      new Proxy(inner, {
        // Calling the logger directly: `log('…')`.
        apply(target, thisArg, args: unknown[]): void {
          observe(args)
          Reflect.apply(target, thisArg, args)
        },
        get(target, property, receiver): unknown {
          if (property === 'error') {
            return (formatter: unknown, ...rest: unknown[]): void => {
              observe([formatter, ...rest])
              target.error(formatter, ...rest)
            }
          }
          if (property === 'newScope') {
            return (name: string): Logger => wrap(target.newScope(name))
          }
          const value = Reflect.get(target, property, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })

    return {
      forComponent: (name: string): Logger => wrap(base.forComponent(name)),
    }
  }
}
