import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { peerIdFromString } from '@libp2p/peer-id'
import { tcp } from '@libp2p/tcp'
import { multiaddr } from '@multiformats/multiaddr'
import { defaultLogger } from '@libp2p/logger'
import { createLibp2p } from 'libp2p'
import type { ComponentLogger, Libp2p, Logger, Stream } from '@libp2p/interface'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Libp2pTransport,
  MAX_CONCURRENT_STREAMS_PER_PEER,
  MAX_INBOUND_MESSAGE_BYTES,
  MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER,
  O2_RPC_PROTOCOL,
  WIRE_CHUNK_BYTES,
} from '@o2/libp2p'
import type { Libp2pTransportOptions } from '@o2/libp2p'
import { SendRefused } from '@o2/core'
import { RpcEndpoint, RpcFailure } from '@o2/net'

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

/** Streams a test left part-written, aborted in teardown so no send stays parked. */
const holding: Stream[] = []

/**
 * Open a raw o2 stream, write `byteLength` bytes, and leave the write end **open**.
 *
 * `Transport.send` closes write, which is what ends a message — so nothing reachable
 * through the public port can produce the state this bound exists for: many messages
 * from one peer, each one legal, none of them finished. That state is reachable over
 * the real protocol by any peer, so the test reaches it the same way.
 *
 * `byteLength` stays under yamux's 256 KiB initial stream window on purpose, so every
 * `send` completes without waiting on a drain the refused streams will never grant.
 */
async function holdOpen(from: Peer, to: string, byteLength: number): Promise<Stream> {
  const stream = await from.libp2p.dialProtocol(peerIdFromString(to), O2_RPC_PROTOCOL)
  holding.push(stream)
  const bytes = frame(byteLength)
  for (let offset = 0; offset < bytes.byteLength; offset += WIRE_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + WIRE_CHUNK_BYTES, bytes.byteLength))
    if (!stream.send(chunk)) await stream.onDrain()
  }
  return stream
}

/**
 * Force a full GC without a `--expose-gc` on the command line.
 *
 * The flag is not on `npm run test:node`, and adding it would put a V8 flag on every
 * spec in the project to serve one assertion in this file. `v8.setFlagsFromString`
 * plus a fresh context is the same collection, scoped to this module.
 */
const collect = ((): (() => void) => {
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as unknown
  setFlagsFromString('--no-expose-gc')
  return typeof gc === 'function' ? (gc as () => void) : (): void => {}
})()

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
  for (const stream of holding.splice(0)) {
    try {
      stream.abort(new Error('test over'))
    } catch {
      // Already reset by the node under test — which is the point of several cases.
    }
  }
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

describe('the port precondition rpc.ts’s reply correlation rests on', () => {
  /**
   * `Transport` (core/ports.ts) requires `from` and `to` to be one namespace spelled
   * identically. `RpcEndpoint` files a pending request under the `to` it was handed
   * and looks it up under the `from` the transport reported, so a transport that
   * dialled by one spelling and reported by another would turn **every** reply into a
   * timeout — an outage that presents as a broken network rather than as a spelling
   * bug, which is why it is asserted here rather than believed.
   *
   * This is the only level that can catch it. A loopback satisfies the precondition
   * by construction; `Libp2pTransport` derives `from` from `connection.remotePeer`
   * and is dialled by a `PeerId` string, and nothing but a real pair proves those two
   * derivations agree.
   */
  it('reports an answering peer under the exact string its request was addressed to', async () => {
    const [sender, receiver] = await Promise.all([peer(), peer()])
    const to = await dial(sender, receiver)

    // The responder answers with only what it was handed, which is all `RpcEndpoint`
    // has when it replies.
    const answered: string[] = []
    receiver.transport.onMessage((from) => {
      answered.push(from)
      void receiver.transport.send(from, frame(8)).catch(() => {})
    })
    const seen: string[] = []
    sender.transport.onMessage((from) => seen.push(from))

    await sender.transport.send(to, frame(8))

    // Well inside vitest's own 5 s, so a divergence fails by this name rather than as
    // an anonymous test timeout. The green round trip above is two localhost TCP hops.
    expect(await settles(() => seen.length > 0, 2_000), 'the answer never arrived').toBe(true)
    expect(seen).toEqual([to])
    expect(answered).toEqual([sender.transport.localId])
  })
})

describe('NET-08 — a peer cannot make this node allocate an unbounded buffer', () => {
  it('refuses a frame one byte over an overridden bound, and keeps serving', async () => {
    const cap = 64 * 1024
    const [sender, receiver] = await Promise.all([peer(), peer({ maxMessageBytes: cap })])
    const to = await dial(sender, receiver)

    const outcome = await sender.transport
      .send(to, frame(cap + 1))
      .then(() => 'resolved' as const, () => 'rejected' as const)

    // Measured, and pinned rather than left unstated: **at this size the sender is
    // not told.** A frame exactly one byte over the cap only crosses it on its
    // final chunk, so by the time the receiver decides to abort, the sender has
    // written everything and closed its write end, and the reset arrives with
    // nothing left to refuse.
    //
    // That is a reading about *this size*, not about the cap. Re-measured
    // 2026-07-29 across six payload sizes against a 16 KiB cap, six runs each:
    // 256 KiB resolves 6/6, and 512 KiB / 1 MiB / 2 MiB / 4 MiB / 8 MiB **reject**
    // 6/6. `resets the stream …` below is that case, and it is the test the abort
    // itself is load-bearing for.
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

  /**
   * The other half of criterion 3: `readMessage` does not merely *throw* past the
   * cap, it calls `stream.abort(error)` — and this is what makes that call
   * observable rather than decorative.
   *
   * Deleting the single line `stream.abort(error)`
   * (`packages/libp2p/src/libp2p-transport.ts:167`) left 22 tests across three files
   * green — this file's ten, plus `admission.node.test.ts` and
   * `fabric-node.node.test.ts`. Re-run here with the line deleted: 12 green in those
   * two files, 10 green of the 12 in this one, and only the two tests below red. The
   * mutation had survived because nothing in the suite could see the abort at all.
   *
   * The mechanism, read out of `@libp2p/utils`: `AbstractMessageStream.abort` sends
   * a yamux RST (`sendReset`), the sender's stream takes `onRemoteReset` which sets
   * `writeStatus = 'closed'`, and its next `send()` then throws
   * `StreamStateError`. Without the abort the receiving handler's `finally` closes
   * the stream gracefully — write end only — and the sender's remaining writes
   * complete against a peer that has stopped reading.
   *
   * A frame one byte over the cap cannot see any of that, because the sender has
   * nothing left to write when the reset lands. This one has plenty: 1 MiB, over a
   * 16 KiB cap, against yamux's `INITIAL_STREAM_WINDOW` of 256 KiB
   * (`@chainsafe/libp2p-yamux/dist/src/constants.js:17`, reached through
   * `muxer.js:231`'s `...this.streamOptions` and `stream.js:36` — unlike
   * `maxEarlyStreams` in the NET-09 block below, which is declared and never read).
   *
   * 1 MiB rather than the smallest size that works, because the window is not
   * static: yamux reopens it on *receipt* rather than on consumption
   * (`stream.js:176`) and doubles it up to `maxStreamWindowSize` when four round
   * trips fit inside the epoch (`stream.js:233`), so how much a sender gets to push
   * before the RST lands is not a figure this test can derive. What it can say is
   * what was measured: the reading does not reverse as the payload grows — 512 KiB,
   * 1 MiB, 2 MiB, 4 MiB and 8 MiB all reject 6/6. 1 MiB is 2× the smallest
   * rejecting size and stays clear of yamux's 4 MiB `maxReadBufferLength`, which is
   * the other ceiling in reach and would abort the stream for its own reasons.
   *
   * Measured and **rejected** as an instrument, so nobody re-derives it: the muxer's
   * stream count cannot see this mutation. Both nodes read `connection.streams` empty
   * and `connection.status` `'open'` a second after the refusal, with the abort
   * present *and* with it deleted. A half-open stream is not what is left behind.
   */
  it('resets the stream, so a sender still holding a window to write is told', async () => {
    const cap = 16 * 1024
    const [sender, receiver] = await Promise.all([
      // 20 s budget so a rejection *inside* it cannot be the budget expiring.
      peer({ sendTimeoutMs: 20_000 }),
      peer({ maxMessageBytes: cap }),
    ])
    const to = await dial(sender, receiver)

    const at = Date.now()
    const outcome = await sender.transport
      .send(to, frame(1024 * 1024))
      .then(() => 'resolved' as const, (cause: unknown) => cause)
    const elapsed = Date.now() - at

    // The reading the abort produces, stated as the sender sees it.
    expect(outcome).not.toBe('resolved')
    expect(outcome).toBeInstanceOf(Error)
    // Deliberately not asserted on the error's class. The observable this test owns
    // is that the write path stops; which of libp2p's errors carries that is
    // internal to the muxer and would be a pin on a private detail. Recorded
    // instead: every one of the 30 measured rejections was
    // `StreamStateError: Cannot write to a stream that is closed`.
    //
    // Timing is what separates "the reset came back" from "the send timed out".
    // Measured 7–50 ms over 30 runs; the budget above is 20 s.
    expect(elapsed).toBeLessThan(5_000)

    // And the cap is what did it — not a dead peer, not a dial failure.
    expect(await settles(() => receiver.transport.refusedInbound === 1, 10_000)).toBe(true)

    // Nothing reached the layer above. Admissible because the paired positive
    // follows on the same receiver: it delivers when the frame is in limit.
    expect(receiver.received).toEqual([])
    const small = frame(1_024)
    await sender.transport.send(to, small)
    expect(await settles(() => receiver.received.length === 1, 10_000)).toBe(true)
    expect(receiver.received[0]).toEqual(small)
    expect(receiver.transport.refusedInbound).toBe(1)
  }, 60_000)

  /**
   * The receiver's own reading of the same call, independent of the wire.
   *
   * `AbstractMessageStream.abort` logs `this.log.error('abort with error - %e', err)`
   * with the very `InboundTooLarge` `readMessage` constructed
   * (`@libp2p/utils/dist/src/abstract-message-stream.js:133`). That log line is the
   * only local trace the abort leaves, and `ErrorCapture` above already reaches it —
   * the NET-09 block uses the same injection point for `MaxEarlyStreamsError`.
   *
   * Worth having alongside the sender-side test because it is a *different* kind of
   * evidence: it holds at cap + 1, where the wire shows nothing at all, and it names
   * the peer and the byte counts an operator would need.
   */
  it('records the abort reason in the receiving node’s own log, naming peer and counts', async () => {
    const cap = 64 * 1024
    const receiverErrors = new ErrorCapture()
    const [sender, receiver] = await Promise.all([
      peer(),
      peer({ maxMessageBytes: cap }, receiverErrors),
    ])
    const to = await dial(sender, receiver)

    // In-limit first. This capture reads nothing while nothing has been refused —
    // an assertion worth making only because the same object reads the abort a few
    // lines below, which is what proves it was live and looking at the right place.
    await sender.transport.send(to, frame(1_024))
    expect(await settles(() => receiver.received.length === 1, 10_000)).toBe(true)
    expect(receiverErrors.errors.filter((e) => e.name === 'InboundTooLarge')).toEqual([])

    await sender.transport.send(to, frame(cap + 1))
    expect(await settles(() => receiver.transport.refusedInbound === 1, 10_000)).toBe(true)
    expect(
      await settles(() => receiverErrors.errors.some((e) => e.name === 'InboundTooLarge'), 5_000),
    ).toBe(true)

    const aborted = receiverErrors.errors.filter((e) => e.name === 'InboundTooLarge')
    expect(aborted).toHaveLength(1)
    expect(aborted[0]!.message).toContain(sender.transport.localId)
    expect(aborted[0]!.message).toContain(`exceeds ${cap} bytes (reached ${cap + 1})`)
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

/**
 * NET-08's second half — the per-message cap bounds one message, not one peer.
 *
 * Every message below is comfortably inside `maxMessageBytes`, so `refusedInbound`
 * has nothing to say about any of them. What the peer is doing is holding many of
 * them part-written at once, and the sum of those accumulations is what the
 * per-message cap cannot see.
 */
describe('NET-08 — one peer cannot hold an unbounded accumulation across many streams', () => {
  const CAP = 256 * 1024
  /** Under the cap, and under yamux's initial window. Both matter — see `holdOpen`. */
  const PER_STREAM = 200 * 1024
  const BUDGET = CAP * MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER

  it('refuses accumulation past the budget while every single message stays in limit', async () => {
    const [sender, receiver] = await Promise.all([peer(), peer({ maxMessageBytes: CAP })])
    const to = await dial(sender, receiver)

    // Enough streams that the sum clears the budget several times over, opened one
    // at a time so no burst reaches libp2p's early-stream ceiling.
    const streams = Math.ceil((BUDGET * 3) / PER_STREAM)
    for (let i = 0; i < streams; i++) await holdOpen(sender, to, PER_STREAM)

    expect(await settles(() => receiver.transport.refusedOverBudget > 0, 20_000)).toBe(true)

    // The load-bearing pair. A per-message counter that moved here would mean the
    // cap had refused these, and it has not: each message is 200 KiB against a
    // 256 KiB cap. The two counters answer different questions and this is where
    // the difference shows.
    expect(receiver.transport.refusedInbound).toBe(0)
    expect(receiver.transport.refusedOverBudget).toBeGreaterThan(0)
  }, 60_000)

  /**
   * The corroborating reading, and deliberately the *secondary* one.
   *
   * `arrayBuffers` is noisy — libp2p's own muxer buffers land in it too — so it is
   * not what stands between the tree and a regression; the counter above is. What it
   * adds is that the counter is not merely incrementing while the bytes pile up
   * anyway, which is the failure a counter alone cannot distinguish.
   *
   * It also reads high, and knowing why keeps the threshold honest: both peers live
   * in this one process, so `arrayBuffers` counts the *sender's* yamux buffers as
   * well as the receiver's accumulation. The reading is a difference between two
   * populations, not a measurement of the budget.
   *
   * Instrument: `process.memoryUsage().arrayBuffers`, delta across the offers, with
   * `collect()` forced either side. Measured 2026-07-30, three runs each, 32 streams
   * × 1.5 MiB against a 2 MiB cap and an 8 MiB budget:
   *
   *   - with the guard:    13.7 MB / 23.9 MB / 28.3 MB
   *   - with the single `budget.charge` line deleted:  65.4 MB / 64.9 MB / 71.7 MB
   *
   * The 40 MB threshold below is placed between those two populations. It is not
   * arithmetic over the budget and must not be re-derived as any.
   */
  it('keeps retained bytes near its budget rather than near what the peer offered', async () => {
    const cap = 2 * 1024 * 1024
    const budget = cap * MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER
    const perStream = 1_536 * 1024
    const streams = 32
    const THRESHOLD = 40 * 1024 * 1024

    const [sender, receiver] = await Promise.all([peer(), peer({ maxMessageBytes: cap })])
    const to = await dial(sender, receiver)

    collect()
    const before = process.memoryUsage().arrayBuffers

    // One at a time, like the case above — a 32-stream burst reaches libp2p's
    // early-stream ceiling and tears the connection down, which is the NET-09 block's
    // subject and would silently substitute for this one's. Each offer is allowed to
    // fail: once the budget is spent the receiver resets the stream, and a write
    // racing that reset is expected to throw. What matters is that the bytes were
    // offered.
    for (let i = 0; i < streams; i++) await holdOpen(sender, to, perStream).catch(() => null)

    collect()
    const retained = process.memoryUsage().arrayBuffers - before

    // Sited on the two measurements in the docblock rather than on arithmetic over
    // the budget. Read before the counter is asserted on, so that with the guard
    // removed this line is what goes red rather than the settle above it.
    expect(retained).toBeLessThan(THRESHOLD)
    // The peer really did offer the bytes that would have been retained — an absent
    // sender satisfies the line above perfectly.
    expect(streams * perStream).toBeGreaterThan(4 * budget)
    expect(receiver.transport.refusedOverBudget).toBeGreaterThan(0)
  }, 120_000)

  it('still delivers an in-limit message from the same peer once the budget frees up', async () => {
    const [sender, receiver] = await Promise.all([peer(), peer({ maxMessageBytes: CAP })])
    const to = await dial(sender, receiver)

    const streams = Math.ceil((BUDGET * 3) / PER_STREAM)
    for (let i = 0; i < streams; i++) await holdOpen(sender, to, PER_STREAM)
    expect(await settles(() => receiver.transport.refusedOverBudget > 0, 20_000)).toBe(true)

    // Finish what is still open, so the charges those calls hold are given back.
    for (const stream of holding.splice(0)) await stream.close().catch(() => {})

    const small = frame(1_024)
    await sender.transport.send(to, small)
    expect(
      await settles(() => receiver.received.some((m) => m.byteLength === small.byteLength), 20_000),
    ).toBe(true)
    expect(receiver.transport.refusedInbound).toBe(0)
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

/**
 * NET-09 criterion 5, on the real stack — the refusal survives its trip through
 * `RpcEndpoint`, and the contrast case survives with it.
 *
 * The unit-level cases live in `packages/net/src/rpc.test.ts` and
 * `packages/net/src/churn.test.ts`, where the `RpcFailure` is constructed
 * directly. These two are the same distinction produced by a real transport: one
 * refusal from this node's own gate, one dial to a peer that was never dialled.
 */
describe('NET-09 — a gate refusal and a dead peer, told apart over the real transport', () => {
  it('surfaces this node’s own gate refusal as RpcFailure{send-refused}, naming this node', async () => {
    const [sender, receiver] = await Promise.all([peer({ maxQueuedSendsPerPeer: 1 }), peer()])
    const to = await dial(sender, receiver)

    // Short budget: the requests that *do* get sent have no handler to answer
    // them, so they cost their own timeout. Only the refusals are the subject.
    const rpc = new RpcEndpoint(sender.transport, { timeoutMs: 3_000 })
    try {
      const settled = await Promise.allSettled(
        Array.from({ length: 24 }, () => rpc.request(to, { probe: true })),
      )
      const refusals = settled
        .filter((r) => r.status === 'rejected')
        .map((r) => (r as PromiseRejectedResult).reason)
        .filter((e): e is RpcFailure => e instanceof RpcFailure)
        .filter((e) => e.detail.kind === 'send-refused')

      expect(refusals.length).toBeGreaterThan(0)
      for (const refusal of refusals) {
        const detail = refusal.detail
        if (detail.kind !== 'send-refused') continue
        expect(detail.by).toBe(sender.transport.localId)
        expect(detail.to).toBe(to)
      }
    } finally {
      rpc.close()
    }
  }, 60_000)

  it('keeps a request to a never-dialled peer as RpcFailure{send-failed}', async () => {
    const [sender, stranger] = await Promise.all([peer(), peer()])
    // Deliberately not dialled: `send` will reject out of `dialProtocol`, which is
    // the route a genuinely dead receiver takes. It must NOT be attributed to this
    // node — that is the misattribution criterion 5 exists to remove, pointed the
    // other way.
    const to = stranger.libp2p.peerId.toString()

    const rpc = new RpcEndpoint(sender.transport, { timeoutMs: 10_000 })
    try {
      const failure = await rpc.request(to, { probe: true }).then(
        () => null,
        (cause: unknown) => cause,
      )
      expect(failure).toBeInstanceOf(RpcFailure)
      expect((failure as RpcFailure).detail.kind).toBe('send-failed')
    } finally {
      rpc.close()
    }
  }, 60_000)
})
