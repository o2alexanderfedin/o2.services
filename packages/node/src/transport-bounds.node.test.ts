import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { multiaddr } from '@multiformats/multiaddr'
import { defaultLogger } from '@libp2p/logger'
import { createLibp2p } from 'libp2p'
import type { ComponentLogger, Libp2p, Logger } from '@libp2p/interface'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Libp2pTransport,
  MAX_CONCURRENT_STREAMS_PER_PEER,
  MAX_INBOUND_MESSAGE_BYTES,
} from '@o2/libp2p'
import type { Libp2pTransportOptions } from '@o2/libp2p'
import { SendRefused } from '@o2/core'

/**
 * NET-08 and NET-09 — the two transport bounds, measured against the real stack.
 *
 * The unit under test is `Libp2pTransport` itself, so these nodes are built with
 * `createLibp2p` directly rather than through `FabricNode` — the way
 * `relaying.node.test.ts` builds its reserving peer. `FabricNode` does not thread
 * `Libp2pTransportOptions` at all today (`fabric-node.ts:344` calls
 * `Libp2pTransport.start(libp2p)` bare), so a test that went through the factory
 * would be measuring the factory.
 */

const started: { stop(): void | Promise<void> }[] = []

interface Peer {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  /** Every message this peer's transport delivered, in arrival order. */
  readonly received: Uint8Array[]
}

/**
 * Every `Error` this node's libp2p logged, kept as the object rather than a string.
 *
 * `AbstractMessageStream.abort` calls `this.log.error('abort with error - %e', err)`
 * (`@libp2p/utils/dist/src/abstract-message-stream.js:133`), which is the only place
 * a muxer-level abort reason is observable from outside libp2p's public API. Same
 * injection point `reservation-watch.ts` uses, and the same `Proxy` technique — a
 * hand-written `Logger` stand-in omits `newScope` and crashes every dial.
 */
class ErrorCapture {
  readonly errors: Error[] = []

  get logger(): ComponentLogger {
    const observe = (args: readonly unknown[]): void => {
      for (const arg of args) if (arg instanceof Error) this.errors.push(arg)
    }
    const base = defaultLogger()
    const wrap = (inner: Logger): Logger =>
      new Proxy(inner, {
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
          if (property === 'newScope') return (name: string): Logger => wrap(target.newScope(name))
          const value = Reflect.get(target, property, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    return { forComponent: (name: string): Logger => wrap(base.forComponent(name)) }
  }
}

async function peer(
  options: Libp2pTransportOptions = {},
  capture?: ErrorCapture,
): Promise<Peer> {
  const libp2p = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    ...(capture === undefined ? {} : { logger: capture.logger }),
  })
  const transport = await Libp2pTransport.start(libp2p, options)
  const received: Uint8Array[] = []
  transport.onMessage((_from, message) => {
    received.push(message)
  })
  started.push({
    async stop() {
      await transport.stop().catch(() => {})
      await libp2p.stop()
    },
  })
  return { libp2p, transport, received }
}

/** Dial `to` from `from` so `Transport.send` can reach it by peer id. */
async function dial(from: Peer, to: Peer): Promise<string> {
  const address = to.libp2p.getMultiaddrs()[0]
  if (address === undefined) throw new Error('peer bound no address')
  await from.libp2p.dial(multiaddr(address.toString()))
  return to.libp2p.peerId.toString()
}

/** A frame of `n` bytes whose contents are position-dependent, so truncation shows. */
function frame(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i++) bytes[i] = (i * 31) & 0xff
  return bytes
}

/** Wait until `predicate` holds, or give up after `timeoutMs`. Returns whether it held. */
async function settles(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return true
    if (Date.now() > deadline) return false
    await new Promise((r) => setTimeout(r, 25))
  }
}

afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (n) => {
      try {
        await n.stop()
      } catch {
        // A node that already failed to start is not worth failing teardown over.
      }
    }),
  )
})

describe('NET-08 — a peer cannot make this node allocate an unbounded buffer', () => {
  it('refuses a frame one byte over an overridden bound, and keeps serving', async () => {
    const cap = 64 * 1024
    const [sender, receiver] = await Promise.all([peer(), peer({ maxMessageBytes: cap })])
    const to = await dial(sender, receiver)

    const outcome = await sender.transport
      .send(to, frame(cap + 1))
      .then(() => 'resolved' as const, () => 'rejected' as const)

    // Measured, and pinned rather than left unstated: **the sender is not told.**
    // A frame exactly one byte over the cap only crosses it on its final chunk, so
    // by the time the receiver decides to abort, the sender has written everything
    // and closed its write end. The receive cap is a receiver-side guard, not a
    // signal back down the wire — a requestor learns only by timing out.
    expect(outcome).toBe('resolved')

    // The oversize frame never reaches the layer above.
    expect(await settles(() => receiver.received.length > 0, 1_000)).toBe(false)
    expect(receiver.transport.refusedInbound).toBe(1)

    // Still alive, and still serving: an in-limit frame afterwards arrives intact.
    const small = frame(1_024)
    await sender.transport.send(to, small)
    expect(await settles(() => receiver.received.length === 1, 5_000)).toBe(true)
    expect(receiver.received[0]).toEqual(small)
    expect(receiver.transport.refusedInbound).toBe(1)
  }, 60_000)

  it('delivers a frame of exactly the bound, and counts no refusal', async () => {
    const cap = 64 * 1024
    const [sender, receiver] = await Promise.all([peer(), peer({ maxMessageBytes: cap })])
    const to = await dial(sender, receiver)

    const exact = frame(cap)
    await sender.transport.send(to, exact)
    expect(await settles(() => receiver.received.length === 1, 10_000)).toBe(true)
    expect(receiver.received[0]).toEqual(exact)
    expect(receiver.transport.refusedInbound).toBe(0)
  }, 60_000)

  it('enforces the shipped default with no override anywhere', async () => {
    const [sender, receiver] = await Promise.all([peer(), peer()])
    const to = await dial(sender, receiver)

    const outcome = await sender.transport
      .send(to, frame(MAX_INBOUND_MESSAGE_BYTES + 1))
      .then(() => 'resolved' as const, () => 'rejected' as const)
    // Same reading at the shipped bound as at the overridden one — see above.
    expect(outcome).toBe('resolved')
    expect(await settles(() => receiver.received.length > 0, 1_000)).toBe(false)
    expect(receiver.transport.refusedInbound).toBe(1)

    // The 100 KiB block `fabric-node.node.test.ts` deliberately carries, restated
    // at the layer that owns the cap.
    const block = frame(100 * 1024)
    await sender.transport.send(to, block)
    expect(await settles(() => receiver.received.length === 1, 10_000)).toBe(true)
    expect(receiver.received[0]).toEqual(block)
    expect(receiver.transport.refusedInbound).toBe(1)
  }, 60_000)
})

describe('NET-09 — a per-peer send gate, and the tear-down it exists to stop', () => {
  /**
   * The tear-down, reproduced. **This is the instrument the negative reading below
   * depends on**, so it runs first and must stay non-empty.
   *
   * The `MaxEarlyStreamsError` is raised on the **receiving** node's muxer, not on
   * the sender's rejected promise — measured 2026-07-29; the sender only ever sees
   * `StreamResetError` / `UnexpectedEOFError`, which name a symptom and not its
   * cause. So the assertion is on the receiver's `ErrorCapture`.
   */
  it('tears the connection down when the gate is widened to 32', async () => {
    const senderErrors = new ErrorCapture()
    const receiverErrors = new ErrorCapture()
    const [sender, receiver] = await Promise.all([
      peer({ maxConcurrentStreamsPerPeer: 32 }, senderErrors),
      peer({}, receiverErrors),
    ])
    const to = await dial(sender, receiver)

    const results = await Promise.allSettled(
      Array.from({ length: 32 }, () => sender.transport.send(to, frame(64))),
    )
    await settles(() => receiver.received.length === 32, 3_000)

    // The instrument read something. An empty capture here would make the paired
    // assertion in the next test worth nothing at all.
    expect(receiverErrors.errors.length).toBeGreaterThan(0)
    const early = receiverErrors.errors.filter((e) => e.name === 'MaxEarlyStreamsError')
    expect(early.length).toBeGreaterThan(0)

    // And the damage: sends died and messages did not arrive.
    expect(results.filter((r) => r.status === 'rejected').length).toBeGreaterThan(0)
    expect(receiver.received.length).toBeLessThan(32)

    // **The runtime pin on libp2p's operative `maxEarlyStreams` default.**
    // `AbstractStreamMuxer`'s `init.maxEarlyStreams ?? 10`
    // (`@libp2p/utils/dist/src/abstract-stream-muxer.js:24`) is not exported and
    // has no importable form, so the denominator of the error it throws is the
    // only runtime read of the value available anywhere in this repository. It is
    // asserted here, in the same `it` that produced the error and off the same
    // captured object, because separate vitest files share no runtime state — a
    // pin placed in `constants.node.test.ts` could only re-read the `.d.ts` or
    // yamux's unread `defaultConfig`, which is exactly what this avoids.
    // `MAX_CONCURRENT_STREAMS_PER_PEER` was chosen to sit below it.
    //
    // The reproduction *is* the pin's instrument: if this stops reproducing, the
    // pin is gone with it, and that must be reported rather than absorbed.
    const denominator = /(\d+)\/(\d+)$/.exec(early[0]!.message)
    expect(denominator).not.toBeNull()
    expect(Number(denominator![2])).toBe(10)
    expect(MAX_CONCURRENT_STREAMS_PER_PEER).toBeLessThan(Number(denominator![2]))
  }, 60_000)

  it('delivers all 32 at the shipped bound, with no tear-down and the connection intact', async () => {
    const receiverErrors = new ErrorCapture()
    const [sender, receiver] = await Promise.all([peer(), peer({}, receiverErrors)])
    const to = await dial(sender, receiver)

    await Promise.all(Array.from({ length: 32 }, () => sender.transport.send(to, frame(64))))
    expect(await settles(() => receiver.received.length === 32, 20_000)).toBe(true)

    // The paired negative: the same harness that read a `MaxEarlyStreamsError` in
    // the test above reads none here. Admissible only because that test proved it
    // reads at all.
    expect(receiverErrors.errors.filter((e) => e.name === 'MaxEarlyStreamsError')).toEqual([])

    // Still connected, and a 33rd request afterwards still works.
    expect(sender.libp2p.getPeers().map((p) => p.toString())).toContain(to)
    await sender.transport.send(to, frame(64))
    expect(await settles(() => receiver.received.length === 33, 10_000)).toBe(true)

    // A bound on *concurrency*. It is NOT a bound on the cumulative count libp2p's
    // `earlyStreams` accumulates within its pre-listener window — that array is
    // never decremented on stream close, so 32 streams were still opened in total.
    // The lower bound matters as much as the upper: `<= 8` alone would pass if the
    // burst had never happened.
    expect(sender.transport.peakStreamsTo(to)).toBeLessThanOrEqual(MAX_CONCURRENT_STREAMS_PER_PEER)
    expect(sender.transport.peakStreamsTo(to)).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('gates two peers independently, so a second peer adds throughput', async () => {
    const [sender, first, second] = await Promise.all([peer(), peer(), peer()])
    const [toFirst, toSecond] = await Promise.all([dial(sender, first), dial(sender, second)])

    await Promise.all([
      ...Array.from({ length: 32 }, () => sender.transport.send(toFirst, frame(64))),
      ...Array.from({ length: 32 }, () => sender.transport.send(toSecond, frame(64))),
    ])
    expect(
      await settles(() => first.received.length === 32 && second.received.length === 32, 20_000),
    ).toBe(true)

    for (const to of [toFirst, toSecond]) {
      expect(sender.transport.peakStreamsTo(to)).toBeLessThanOrEqual(MAX_CONCURRENT_STREAMS_PER_PEER)
      expect(sender.transport.peakStreamsTo(to)).toBeGreaterThanOrEqual(2)
    }
  }, 60_000)

  it('refuses past the queue bound at once, naming this node, rather than waiting', async () => {
    const [sender, receiver] = await Promise.all([
      peer({ maxQueuedSendsPerPeer: 4, sendTimeoutMs: 20_000 }),
      peer(),
    ])
    const to = await dial(sender, receiver)

    // 8 in flight + 4 queued = 12 admitted; the 13th onward are refused.
    const started = Date.now()
    const results = await Promise.allSettled(
      Array.from({ length: 24 }, () => sender.transport.send(to, frame(64))),
    )
    const refusals = results
      .filter((r) => r.status === 'rejected')
      .map((r) => (r as PromiseRejectedResult).reason as unknown)

    expect(refusals.length).toBeGreaterThan(0)
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(SendRefused)
      const named = refusal as SendRefused
      expect(named.by).toBe(sender.transport.localId)
      expect(named.to).toBe(to)
      // Names both bounds and the current depth, so an operator reads it whole.
      expect(named.message).toContain(`${MAX_CONCURRENT_STREAMS_PER_PEER}`)
      expect(named.message).toContain('4 sends queued')
    }

    // "It rejected eventually" and "it refused at once" are different guarantees
    // and only the second is a usable signal. 20 s send timeout above; this whole
    // burst settles far inside it.
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 60_000)

  it('does not strand a send parked behind the gate when the transport stops', async () => {
    const [sender, receiver] = await Promise.all([
      peer({ maxQueuedSendsPerPeer: 64, sendTimeoutMs: 60_000 }),
      peer(),
    ])
    const to = await dial(sender, receiver)

    // A big enough payload that the first eight are still in flight when `stop`
    // lands, so there is genuinely something parked behind the gate.
    const results = Array.from({ length: 40 }, () => sender.transport.send(to, frame(512 * 1024)))
    const settledResults = results.map((p) => p.then(() => 'ok' as const, (e: unknown) => e))
    await sender.transport.stop()

    const outcomes = await Promise.all(settledResults)
    const stopped = outcomes.filter(
      (o) => o instanceof Error && o.message === 'transport stopped',
    )
    expect(stopped.length).toBeGreaterThan(0)
    // A shutdown is not this node's admission bound refusing.
    expect(outcomes.some((o) => o instanceof SendRefused)).toBe(false)
  }, 60_000)
})
