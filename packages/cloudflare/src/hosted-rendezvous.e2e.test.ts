/**
 * Two peers on the hosted relay find each other — through the relay, on a real workerd.
 *
 * ## The defect this reproduces, then closes
 *
 * Measured 2026-08-31 against the deployed node: `findReservedPeers` speaks the fabric's own
 * `/o2/rpc/1.0.0`, and `hosted-libp2p.ts` registered **no handler for it**. So the one
 * always-reachable node in this fabric answered nothing at all, and two tabs holding
 * reservations on it stayed invisible to each other — the exact failure `rendezvous.ts`'s
 * header describes, reintroduced by the tier built to prevent it. A tab could still be told
 * an address out of band, which is how `two-tabs.e2e.test.ts` gets its pair connected; what
 * it could not do is *discover* one.
 *
 * Run against the tree before the fix, this file's first case fails with `answered: 0` and
 * `addrs: []`. That red IS the finding.
 *
 * ## Why a real workerd and not the unit fixture
 *
 * `rendezvous.test.ts` proves what {@link serveReservations} does with a request. It cannot
 * prove that a reservation granted by `circuitRelayServer` on a Durable Object appears in the
 * store that handler reads — which is three layers away from anything a memory transport
 * touches, and the layer where a wiring mistake actually lives. The `/p2p-circuit` listen is
 * the same one `relay-service-journal.e2e.test.ts` uses, and for the same reason: a client
 * carrying only `webSockets()` never opens a hop stream and would make this file green for
 * nothing.
 *
 * ## What this file does NOT claim
 *
 * That the two clients can then *reach* each other. That is a WebRTC dial over the address
 * this rendezvous produced, and it belongs to the browser lane where a real WebRTC stack
 * exists. What is claimed is the half that was missing: the address is discoverable at all,
 * from a peer that was told only the relay.
 *
 * Its own port and its own `--persist-to` directory, because the `e2e` lane's
 * `fileParallelism: false` is a discipline rather than a guarantee and two files sharing
 * `.wrangler/state` have already reddened each other here once.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from 'libp2p'
import { afterAll, describe, expect, it } from 'vitest'
import { Libp2pTransport } from '@o2/libp2p'
import { RpcEndpoint, encodeRequest, findReservedPeers, parseResponse } from '@o2/net'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const PORT = 8794
const HOST = '127.0.0.1'

/** This file's own Durable Object storage — see the header. */
const PERSIST_DIR = mkdtempSync(join(tmpdir(), 'o2-rendezvous-'))

let worker: ChildProcess | undefined

afterAll(() => {
  worker?.kill('SIGTERM')
  rmSync(PERSIST_DIR, { recursive: true, force: true })
})

/** Start `wrangler dev` and wait until `/self` answers. */
async function startWorker(): Promise<void> {
  worker = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--local-protocol', 'http', '--persist-to', PERSIST_DIR],
    {
      cwd: PACKAGE_DIR,
      // `CLOUDFLARE_API_TOKEN` is blanked so a path reaching for Cloudflare fails here
      // rather than quietly succeeding against the owner's account.
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  const deadline = Date.now() + 120_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${PORT}/self`, { signal: AbortSignal.timeout(3000) })
      if (response.ok) {
        await response.json()
        return
      }
      lastError = new Error(`/self answered ${String(response.status)}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within 120 s: ${String(lastError)}`)
}

/** The relay's peer id, read off the route that reports it. */
async function relayPeerId(): Promise<string> {
  const response = await fetch(`http://${HOST}:${PORT}/self`, { signal: AbortSignal.timeout(5000) })
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('peerId' in body) || typeof body.peerId !== 'string') {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  return body.peerId
}

/** A peer that asks the relay for a slot — the one `inbound-listener.e2e.test.ts` has none of. */
async function reservingClient(): Promise<Libp2p> {
  const node = await createLibp2p({
    addresses: { listen: ['/p2p-circuit'] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  await node.start()
  return node
}

/**
 * A peer that asks the question, carrying the fabric's own RPC.
 *
 * `Libp2pTransport` rather than a hand-rolled dial: the framing, the chunking and
 * `runOnLimitedConnection` are the wire's, and a second spelling of them here would be
 * testing this file's understanding of the protocol instead of the node's.
 */
async function seekingClient(): Promise<{ node: Libp2p; rpc: RpcEndpoint }> {
  const node = await createLibp2p({
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  await node.start()
  const transport = await Libp2pTransport.start(node)
  return { node, rpc: new RpcEndpoint(transport, { timeoutMs: 20_000 }) }
}

describe('the hosted relay introduces the peers reserved on it', () => {
  it('answers a peer that knows only the relay with the address of one that reserved', async () => {
    await startWorker()
    const relay = await relayPeerId()
    const relayAddr = multiaddr(`/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${relay}`)

    const reserver = await reservingClient()
    const seeker = await seekingClient()
    try {
      await reserver.dial(relayAddr, { signal: AbortSignal.timeout(30_000) })
      await seeker.node.dial(relayAddr, { signal: AbortSignal.timeout(30_000) })

      // Polled rather than slept: a reservation follows the connection, and a fixed wait
      // would encode this machine's timing into the assertion.
      const deadline = Date.now() + 60_000
      let found = await findReservedPeers({
        rpc: seeker.rpc,
        peers: () => [relay],
        self: seeker.node.peerId.toString(),
      })
      while (found.addrs.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        found = await findReservedPeers({
          rpc: seeker.rpc,
          peers: () => [relay],
          self: seeker.node.peerId.toString(),
        })
      }

      // **`answered` first, because the two failures are different.** Zero means the relay
      // does not speak `/o2/rpc/1.0.0` at all — the defect. One with no addresses would mean
      // it answers and holds nobody, which is a reservation problem and not this one.
      expect(found.answered, 'the relay did not answer /o2/rpc/1.0.0 at all').toBe(1)
      expect(found.addrs).toEqual([
        `/p2p/${relay}/p2p-circuit/webrtc/p2p/${reserver.peerId.toString()}`,
      ])
      // The seeker is never handed itself. It holds no reservation here, so this is the
      // weaker of the two readings — kept because it is free and the address list is exact.
      expect(found.addrs.some((addr) => addr.endsWith(seeker.node.peerId.toString()))).toBe(false)
    } finally {
      await seeker.node.stop()
      await reserver.stop()
    }
  }, 300_000)

  it('refuses a compute request by name, so the tier ships no capability it has no phase for', async () => {
    const relay = await relayPeerId()
    const relayAddr = multiaddr(`/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${relay}`)
    const seeker = await seekingClient()
    try {
      await seeker.node.dial(relayAddr, { signal: AbortSignal.timeout(30_000) })

      const answer = parseResponse(
        await seeker.rpc.request(relay, encodeRequest({ kind: 'offer', shardId: 'shard-1' })),
      )

      // Not a hang and not a dropped frame — and not an acceptance either. A relay that
      // answered `offer` would be a relay that had quietly become an executor.
      expect(answer).toEqual({
        kind: 'error',
        reason: 'this node serves reservations only, not offer',
      })
    } finally {
      await seeker.node.stop()
    }
  }, 300_000)
})
