import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { afterEach, describe, expect, it } from 'vitest'
import { RELAY_DATA_LIMIT_BYTES, Libp2pTransport } from '@o2/libp2p'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
// `relayedBudgetPerDirection` is deliberately off the `@o2/libp2p` barrel (its only
// consumer is inside that package), and this file is where the derivation is proved.
import { relayedBudgetPerDirection } from '../../libp2p/src/constants.ts'
import { RpcEndpoint, RpcFailure } from '@o2/net'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-13 — the relayed rung's budget, per direction, measured on the relayed path.
 *
 * ## The claim, and the reading it replaces
 *
 * `RELAY_DATA_LIMIT_BYTES` is 131 072, and until 2026-09-02 its own docblock read
 * *"in total, in each direction"*. Two readings at once, and a design takes the
 * generous one: 128 KiB reads as an allowance **per direction**, so a symmetric
 * request/response protocol sized against it budgets twice the room it has. There is
 * one counter. `createLimitedRelay` builds a single `dataLimit` object and hands the
 * same object to `countStreamBytes` for each direction, so bytes out and bytes back
 * decrement one number and the circuit is aborted when it goes negative. The first
 * case below pins that source; every case after it measures the consequence.
 *
 * ## Why every case here runs over a **relay**
 *
 * NET-13 says it in the requirement: *a boundary test exercises the relayed path, not
 * only direct WebRTC*. A test on a direct connection **cannot fail this way**, and
 * this file proves that rather than asserting it — the fourth case runs the identical
 * exchange, at the identical size, over an unlimited connection, and it completes. So a
 * green here is a green about the relay and not about the size.
 *
 * ## The arrangement
 *
 * A real `circuitRelayServer()`, started by `FabricNode` on this project's own
 * defaults — no `dataLimitBytes` override anywhere in this file, deliberately, so that
 * the figure under test is the shipped one and a mutation of the shipped one is
 * reachable. Two peers listening on nothing but `/p2p-circuit`, so neither has an
 * address of its own and the only path between them is through the relay. They speak
 * the fabric's own protocol over `Libp2pTransport`, which is the symmetric
 * request/response protocol the requirement is about.
 *
 * ## The framing hazard, which is why the boundary assertions are on **content**
 *
 * This transport's message boundary is *the stream ended* — one message per stream, no
 * length prefix (`libp2p-transport.ts`'s header says so). A premature clean end is
 * therefore indistinguishable from a complete message, and that is not hypothetical
 * here: when the relay cuts the circuit mid-echo, the short remainder is dispatched to
 * the application as a whole message and `refusedInbound` stays 0. Measured
 * 2026-09-02 — at 64 KiB each way the echo arrived as 49 152 bytes, at 63 KiB as 0
 * bytes, both reported complete. **So "did a reply arrive" is a question the cut
 * answers yes to**, and a boundary case resting on it would be green on the failure it
 * exists to catch. Every assertion below is on the bytes, and on whether the circuit
 * survived.
 *
 * ## Proved able to fail — three plants, each watched red and restored `cmp`-clean
 *
 * 1. **The shipped relay limit.** `fabric-node.ts`'s `defaultDataLimit:
 *    options.dataLimitBytes ?? RELAY_DATA_LIMIT_BYTES` → `?? 1_073_741_824n`. The
 *    boundary case alone went red — *"Error: timed out waiting for the relay to cut the
 *    circuit"* — while the in-budget case and the direct control stayed green, which is
 *    what makes the failure attributable to the relay's figure and not to the size.
 * 2. **The control-only gate.** `pathTo(to) === 'control-only'` → `'carries-work'`, so
 *    the bulk send goes out. The refusal case went red: *"expected 'send-failed' to be
 *    'send-refused'"*. **That is the assertion carrying the claim**, and it is worth
 *    saying which one did not: the elapsed-time bound did **not** move, because with the
 *    gate open the relay cut the circuit and `send` rejected in 173 ms rather than
 *    waiting out the timeout. So what the gate buys is not primarily speed — it is
 *    *attribution*. `churn.ts`'s table files `send-failed` under `'node'`, "the peer
 *    never answered", so without the gate a requestor blames a peer that was never at
 *    fault for a condition of the pair.
 * 3. **The classification itself.** `isControlPath` → `return false`. Four cases went
 *    red together, three of them *"expected 'carries-work' to be 'control-only'"* and
 *    the fourth the refusal one, which is the right blast radius: everything downstream
 *    of the reading fails when the reading does.
 */

const started: { stop(): void | Promise<void> }[] = []

interface Peer {
  readonly libp2p: Libp2p
  readonly transport: Libp2pTransport
  /** Every message this peer's transport delivered, in arrival order. */
  readonly received: Uint8Array[]
}

/** Wait until `f` returns something, or fail after `timeoutMs`. */
async function until<T>(f: () => T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = f()
    if (value !== undefined && value !== false) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A relaying node on this project's shipped defaults.
 *
 * **No `dataLimitBytes`.** `FabricNode` reads `options.dataLimitBytes ??
 * RELAY_DATA_LIMIT_BYTES`, so passing one would put the constant on the unused side of
 * a `??` and every case in this file would pass with the shipped figure mutated to
 * anything at all — the same reasoning `MAX_INBOUND_MESSAGE_BYTES` records about
 * proving the shipped value is the enforced one and not only the override.
 */
async function relayingNode(): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // DET-03: nothing here dispatches a task, so provenance is not what is read.
    trustAnchors: 'runs-unsigned-artifacts',
  })
  started.push(node)
  return node
}

/** A peer with no address of its own — reachable only through the relay it dials. */
async function circuitPeer(relayAddress: string): Promise<Peer> {
  const libp2p = await createLibp2p({
    addresses: { listen: ['/p2p-circuit'] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  const transport = await Libp2pTransport.start(libp2p)
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
  await libp2p.dial(multiaddr(relayAddress))
  await until(
    () => libp2p.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit')),
    30_000,
    'a reservation to produce a circuit address',
  )
  return { libp2p, transport, received }
}

/** A peer that binds a real address, so a pair of them connect directly. */
async function directPeer(): Promise<Peer> {
  const libp2p = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  const transport = await Libp2pTransport.start(libp2p)
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

/** Echo every message straight back, which is what makes the exchange symmetric. */
function echoBack(peer: Peer): void {
  peer.transport.onMessage((from, message) => {
    void peer.transport
      .send(from, new Uint8Array(message) as Uint8Array<ArrayBuffer>)
      .catch(() => {
        // The far end has been cut; the assertions read the bytes, not this.
      })
  })
}

/** `n` bytes whose value depends on position, so a truncation cannot look correct. */
function frame(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n)
  for (let index = 0; index < n; index += 1) bytes[index] = (index * 31 + 7) & 0xff
  return bytes
}

/** Bytes-equal, asserted on content rather than on length — see the header. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false
  return true
}

/** One relayed pair, already connected, with `b` echoing. */
async function relayedPair(): Promise<{ a: Peer; b: Peer; relay: FabricNode }> {
  const relay = await relayingNode()
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('the relay bound no browser-dialable address')
  const a = await circuitPeer(address)
  const b = await circuitPeer(address)
  const circuit = await until(
    () => b.libp2p.getMultiaddrs().map(String).find((s) => s.includes('/p2p-circuit')),
    30_000,
    "b's circuit address",
  )
  await a.libp2p.dial(multiaddr(circuit))
  echoBack(b)
  return { a, b, relay }
}

afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (node) => {
      try {
        await node.stop()
      } catch {
        // A node that already failed to start is not worth failing teardown over.
      }
    }),
  )
})

describe('NET-13 — the relayed budget is one counter, spent by both directions', () => {
  it('pins the one shared counter in the installed relay, which is why the figure halves', () => {
    // The same idiom `relaying.node.test.ts` uses for the reservation error templates:
    // the claim rests on installed source, so a dependency bump that splits the counter
    // into one per direction — which would *double* the budget — fails here rather than
    // being discovered by a design that had already been sized against the wrong number.
    const require = createRequire(import.meta.url)
    const pkg = dirname(require.resolve('@libp2p/circuit-relay-v2'))
    const utils = readFileSync(join(pkg, 'utils.js'), 'utf8')

    // One object is built…
    expect(utils).toContain('dataLimit = {')
    expect(utils).toContain('remaining: reservation.limit.data')
    // …and the same one is handed to both directions. `dst` is the far end, `src` the
    // near one; two separate limit objects here would be two separate budgets.
    expect(utils).toContain('countStreamBytes(dst, dataLimit, options)')
    expect(utils).toContain('countStreamBytes(src, dataLimit, options)')
    // And it is a subtraction against that one object, aborting when it goes negative.
    expect(utils).toContain('limit.remaining -= len')
    expect(utils).toContain('if (limit.remaining < 0)')

    // The derived figure the fabric quotes, and its relationship to the limit it comes
    // from. Written as a literal rather than as `RELAY_DATA_LIMIT_BYTES / 2n`, because
    // an assertion that recomputes the value it is testing moves with it.
    expect(relayedBudgetPerDirection()).toBe(65_536n)
    expect(relayedBudgetPerDirection() * 2n).toBe(RELAY_DATA_LIMIT_BYTES)
    // A relay tuned elsewhere gets a per-direction budget that follows it.
    expect(relayedBudgetPerDirection(262_144n)).toBe(131_072n)
  })

  it('carries a symmetric exchange inside the per-direction budget, over the relay', async () => {
    // 62 KiB each way — 126 976 of the 131 072 — which is the largest size measured to
    // survive on this arrangement. It is *under* `relayedBudgetPerDirection()`, and it
    // has to be: the counter is on wire bytes, so the noise handshake, identify and
    // every frame header are paid out of the same 131 072.
    const half = 62 * 1024
    const { a, b } = await relayedPair()
    const target = b.libp2p.peerId.toString()

    // The pair is relayed and nothing else — one connection, and libp2p calls it
    // limited. If this ever reads more than one, the budget arithmetic below is about
    // a different connection than the one the reply travels on.
    const connections = a.libp2p.getConnections(b.libp2p.peerId)
    expect(connections).toHaveLength(1)
    expect(connections[0]?.limits).not.toBeUndefined()
    expect(a.transport.pathTo(target)).toBe('control-only')

    const sent = frame(half)
    await a.transport.send(target, sent)
    await until(() => a.received.length > 0, 20_000, 'the echo to come back')

    // On the bytes, never on arrival — see the header's note on framing.
    expect(b.received).toHaveLength(1)
    expect(sameBytes(b.received[0]!, sent)).toBe(true)
    expect(a.received).toHaveLength(1)
    expect(sameBytes(a.received[0]!, sent)).toBe(true)
    // And the circuit is still there, which is the observable the boundary case loses.
    expect(a.libp2p.getConnections(b.libp2p.peerId)).toHaveLength(1)
  }, 120_000)

  it('cuts the circuit at 64 KiB each way — the size a "128 KiB per direction" reading calls safe', async () => {
    // **This is the requirement's own number.** 65 536 out and 65 536 back is half of
    // what 131 072 reads as if the figure were per-direction, so a protocol that had
    // taken the generous reading would consider this exchange to have 50% headroom.
    // It has none: 65 536 + 65 536 is 131 072, the limit exactly, before a single byte
    // of noise or yamux framing.
    const half = 64 * 1024
    expect(BigInt(half)).toBe(relayedBudgetPerDirection())

    const { a, b } = await relayedPair()
    const target = b.libp2p.peerId.toString()
    const sent = frame(half)

    // Sent through the ordinary `send`, and criterion 4's gate below does **not** fire
    // on it: that gate refuses a message *larger* than its own direction's budget, and
    // this one is exactly the budget. Which is the whole finding stated as an
    // arrangement — a message that fits its direction by the specification's own figure
    // still cannot survive a symmetric exchange, because the figure is a ceiling that
    // the wire framing already spends part of. Nothing this node could check about the
    // outbound message alone would have stopped it.
    await a.transport.send(target, sent)

    // The observable of the cut: the circuit is gone. Not "the reply did not arrive" —
    // a reply *does* arrive, short, and is reported complete.
    await until(
      () => a.libp2p.getConnections(b.libp2p.peerId).length === 0,
      30_000,
      'the relay to cut the circuit',
    )

    // The request itself crossed whole; the budget was not exhausted on the way out.
    expect(b.received).toHaveLength(1)
    expect(sameBytes(b.received[0]!, sent)).toBe(true)

    // And the echo did not. Asserted on content, so a short-but-clean delivery — which
    // is what actually happens — cannot satisfy it.
    for (const message of a.received) expect(sameBytes(message, sent)).toBe(false)

    // The recorded reason the assertion above is on content and not on arrival: the
    // receiving transport cannot tell it was cut. It counted no refusal, and whatever
    // it dispatched it dispatched as a whole message. Measured 2026-09-02: 49 152 bytes
    // at this size, 0 bytes at 63 KiB. **If this ever reads a non-zero refusal count,
    // that is libp2p having started to propagate the abort — a fix, and the moment to
    // revisit this file rather than a regression in it.**
    expect(a.transport.refusedInbound).toBe(0)
    expect(a.received.every((m) => m.byteLength < half)).toBe(true)
  }, 120_000)

  it('carries that same 64 KiB each way over a DIRECT connection, so the cut is the relay’s', async () => {
    // NET-13's own sentence: *a test that exercises only direct WebRTC cannot fail this
    // way and does not count*. This is that test, run on purpose, to show what a green
    // from it would have been worth. Same transport, same protocol, same 65 536 bytes
    // in each direction — and it completes, because nothing is counting them.
    const half = 64 * 1024
    const a = await directPeer()
    const b = await directPeer()
    echoBack(b)
    const address = b.libp2p.getMultiaddrs()[0]
    if (address === undefined) throw new Error('the direct peer bound no address')
    const connection = await a.libp2p.dial(multiaddr(address.toString()))

    // The one difference between this arrangement and the one above, stated rather than
    // assumed: libp2p reports no limits on this connection at all.
    expect(connection.limits).toBeUndefined()
    expect(a.transport.pathTo(b.libp2p.peerId.toString())).toBe('carries-work')

    const sent = frame(half)
    await a.transport.send(b.libp2p.peerId.toString(), sent)
    await until(() => a.received.length > 0, 20_000, 'the echo to come back')

    expect(sameBytes(a.received[0]!, sent)).toBe(true)
    expect(a.libp2p.getConnections(b.libp2p.peerId)).toHaveLength(1)
  }, 120_000)
})

describe('Phase 34 criterion 4 — a pair that fell all the way through is control-only', () => {
  it('reports the relayed pair as control-only and the direct pair as carrying work', async () => {
    const { a, b } = await relayedPair()
    const target = b.libp2p.peerId.toString()

    // The reading a fabric otherwise does not have. `peers` counts this pair — that is
    // the defect, one tier over, that `TabApi.relayedOnly` exists for — and this says
    // what the connection is actually good for.
    expect(a.transport.peers).toContain(target)
    expect(a.transport.pathTo(target)).toBe('control-only')
    expect(a.transport.controlOnlyPeers).toEqual([target])

    // Symmetrically: B reaches A the same way and says so. Waited for rather than read
    // straight away — `dial` resolves on the *dialling* side, and the accepting side
    // registers its connection a moment later, so reading B immediately measures the
    // race and not the classification.
    const back = a.libp2p.peerId.toString()
    await until(
      () => b.libp2p.getConnections(a.libp2p.peerId).length > 0,
      20_000,
      'B to register the inbound circuit',
    )
    expect(b.transport.pathTo(back)).toBe('control-only')

    // A peer never connected to is a third answer, not a false 'control-only'. Without
    // this the getter could report every peer id ever mentioned as relay-only. A real,
    // well-formed peer id — taken from an earlier run of this same file — so what is
    // exercised is the "no open connections" branch and not the malformed-id catch.
    expect(a.transport.pathTo('12D3KooWAJRRmWRyQFczEvACoDdUe5yB1AAyeKcMRxDAyXsqputs')).toBe(
      'unconnected',
    )
  }, 120_000)

  it('refuses a bulk request over that pair by name, in a fraction of the time it would stall', async () => {
    const { a, b } = await relayedPair()
    const target = b.libp2p.peerId.toString()

    // A comparative reading taken inside one run, per this repository's rule: the
    // question is not "was it fast" against some absolute, it is "did it refuse instead
    // of waiting", and the thing it would have waited for is this endpoint's own
    // timeout. Stated here so the comparison and its baseline cannot drift apart.
    const timeoutMs = 20_000
    const caller = new RpcEndpoint(a.transport, { timeoutMs })
    const served = new RpcEndpoint(b.transport, { timeoutMs })
    served.serve(async () => ({ ok: true }))

    // A job's worth of bytes — well past `relayedBudgetPerDirection()`, and the sort of
    // payload the relay would cut part-way, delivering a short frame the far end reports
    // as complete.
    const bulk = { shard: frame(256 * 1024) }

    const startedAt = performance.now()
    let failure: unknown
    try {
      await caller.request(target, bulk)
    } catch (cause) {
      failure = cause
    }
    const elapsedMs = performance.now() - startedAt

    expect(failure).toBeInstanceOf(RpcFailure)
    const detail = (failure as RpcFailure).detail
    // Named, and matched on the literal — not on the English beside it.
    expect(detail.kind).toBe('send-refused')
    if (detail.kind !== 'send-refused') return
    expect(detail.reason).toBe('control-only-path')
    expect(detail.by).toBe(a.transport.localId)
    expect(detail.to).toBe(target)

    // "Rather than stalling", bounded against this endpoint's own timeout. **This is
    // not the assertion that carries the case** — see plant 2 in the header: with the
    // gate removed the send still failed in 173 ms, because the relay cut the circuit
    // rather than leaving the request hanging, so this bound stayed green through the
    // mutation. It is kept because it is the property the criterion names and because a
    // future gate that waited for something would move it; the claim's weight is on the
    // kind and the reason above.
    expect(elapsedMs).toBeLessThan(timeoutMs / 10)

    // And nothing went out: the refusal is a decision, not a failed attempt.
    expect(b.received).toHaveLength(0)

    caller.close()
    served.close()
  }, 120_000)

  it('still carries control traffic over that same pair, which is what a relay is for', async () => {
    // The regression this gate could so easily have been. Rendezvous, offers and every
    // other small exchange negotiate over limited connections deliberately — the
    // transport registers `runOnLimitedConnection: true` for exactly that — so a refusal
    // keyed on the path class alone would silence discovery across the whole fabric. The
    // gate is size **and** path, and this is the half that proves the `and`.
    const { a, b } = await relayedPair()
    const target = b.libp2p.peerId.toString()
    expect(a.transport.pathTo(target)).toBe('control-only')

    const small = frame(1024)
    await a.transport.send(target, small)
    await until(() => a.received.length > 0, 20_000, 'the echo to come back')

    expect(sameBytes(b.received[0]!, small)).toBe(true)
    expect(sameBytes(a.received[0]!, small)).toBe(true)
  }, 120_000)
})
