import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from '@libp2p/interface'
import { afterEach, describe, expect, it } from 'vitest'
import { Libp2pTransport, MAX_INBOUND_MESSAGE_BYTES } from '@o2/libp2p'
import type { Libp2pTransportOptions } from '@o2/libp2p'

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

async function peer(options: Libp2pTransportOptions = {}): Promise<Peer> {
  const libp2p = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
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

