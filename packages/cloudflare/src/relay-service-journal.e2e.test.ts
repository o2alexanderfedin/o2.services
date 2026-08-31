/**
 * The question that started this, answered end to end on a real workerd.
 *
 * *Did a browser reserve on this relay, and when?* On 2026-08-30 the deployed node could not
 * say — `TrafficSplitCounter` is per-instance and holds no history, so an object evicted
 * between the reservation and the reading answers as if nothing had happened. This file is the
 * proof that it can say now, and it takes the reading the way the failure happened: **the
 * process that observed the reservation is killed, and a different one is asked.**
 *
 * ## The four steps, and why each is the one that could not be skipped
 *
 * 1. `wrangler dev` — a real workerd running the deployed module, including
 *    `circuitRelayServer` (`hosted-libp2p.ts:348`). No account, `CLOUDFLARE_API_TOKEN`
 *    blanked, so a path reaching for Cloudflare fails here rather than quietly succeeding.
 * 2. A client carrying `circuitRelayTransport` dials it and listens on `/p2p-circuit`, which
 *    is a RESERVE over `/libp2p/circuit/relay/0.2.0/hop`. `inbound-listener.e2e.test.ts`'s
 *    eight clients carry only `webSockets()` and so never open one — which is why that file
 *    reads all zeros and this one does not.
 * 3. The client stops. That closes the socket, and `BootstrapObject.webSocketClose` banks.
 * 4. **wrangler is killed and started again**, and `GET /self` is asked. Everything held in
 *    memory is gone with the process; `.wrangler/state` is not. A number that survives that
 *    survived more than an eviction.
 *
 * ## What this does NOT claim
 *
 * That the hop stream was a RESERVE rather than a CONNECT. The wire cannot tell them apart —
 * see `relay-service-log.ts` — which is exactly why the field is named
 * `firstInboundHopStreamAt`. What is claimed is what the name says: a peer opened a relay hop
 * stream to this node, this node recorded when, and the record outlived the process.
 *
 * It also does not claim the RESERVATION was granted. The fabric's admission gate may refuse a
 * peer holding no certificate, and that refusal happens *after* the stream is open — so the
 * counter moves either way, and reading it as evidence of a granted reservation would be
 * reading more than the number carries.
 *
 * ## Which banking path actually carries this — measured, three plants
 *
 * `BootstrapObject` banks in two places: `webSocketClose`, and `webSocketMessage` when the
 * marker is known and storage does not have it. Both were planted away, separately and
 * together, against a cleared `.wrangler/state`:
 *
 * | planted away | result |
 * |---|---|
 * | `webSocketClose`'s bank | **green** — the frame path carried it |
 * | `webSocketMessage`'s bank | **green** — the close path carried it |
 * | both | **red**, `expected 0 to be greater than 0` at the post-restart read |
 *
 * So each is independently sufficient here and the case is a real proof rather than one that
 * cannot fail. That the frame path holds it alone is the finding worth keeping: it is the path
 * that exists for the case this arrangement *cannot* produce — an instance evicted while its
 * socket stays open, which never reaches a close handler at all.
 *
 * ## `.e2e.test.ts`, deliberately, and it spawns wrangler TWICE
 *
 * The `e2e` lane runs `fileParallelism: false`. It uses its own port so it cannot collide with
 * `inbound-listener.e2e.test.ts` if that discipline ever changes.
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
import type { RelayServiceTotals } from '@o2/libp2p'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const PORT = 8793
const HOST = '127.0.0.1'

/**
 * This file's OWN Durable Object storage, and it is load-bearing twice over.
 *
 * **MEASURED 2026-08-31: without it this file reddens `inbound-listener.e2e.test.ts`.**
 * `wrangler dev` persists to `<cwd>/.wrangler/state` by default, and both files run
 * `cwd: PACKAGE_DIR` — so they share one object's storage. That file's relay-service case
 * asserts all zeros, correctly, because its eight clients carry no `circuitRelayTransport`.
 * With shared state it read this file's history instead and failed:
 * `expected { inboundHopStreams: 1, … } to deeply equal { inboundHopStreams: +0, … }`, with a
 * `firstInboundHopStreamAt` this file wrote.
 *
 * The second reason is this file's own repeatability. It asserts that the store holds NO
 * marker before it starts, and then writes one — so on shared, persisted state it would pass
 * once and fail on every later run. A check that only works the first time is not a check.
 *
 * A fresh directory per run, wiped at the end. `--persist-to` is the documented flag:
 * `wrangler dev --help` — *"Specify directory to use for local persistence (defaults to
 * .wrangler/state)"* — read from the installed CLI rather than from documentation.
 */
const PERSIST_DIR = mkdtempSync(join(tmpdir(), 'o2-relay-journal-'))

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
      lastError = new Error(`/self answered ${response.status}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within 120 s: ${String(lastError)}`)
}

/** Stop `wrangler dev` and wait for the port to stop answering. */
async function stopWorker(): Promise<void> {
  worker?.kill('SIGTERM')
  worker = undefined
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${HOST}:${PORT}/self`, { signal: AbortSignal.timeout(1000) })
    } catch {
      // Refused or timed out — the port is gone, which is what "stopped" means here.
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('wrangler was still answering 30 s after SIGTERM')
}

interface SelfReading {
  peerId: string
  traffic: { direct: { bytes: number }; relayed: { bytes: number } }
  relayService: RelayServiceTotals
}

/**
 * Read `/self`, refusing a body this file cannot narrow.
 *
 * Field by field rather than a cast: a route that stopped reporting one of the four stream
 * directions would otherwise present as a node that had never done that thing, which is the
 * exact false reading the record exists to prevent.
 */
async function readSelf(): Promise<SelfReading> {
  const response = await fetch(`http://${HOST}:${PORT}/self`, { signal: AbortSignal.timeout(5000) })
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('peerId' in body) || !('traffic' in body) || !('relayService' in body)) {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  const { peerId, traffic, relayService } = body
  if (typeof peerId !== 'string') throw new Error(`/self reported peerId as ${JSON.stringify(peerId)}`)
  if (typeof traffic !== 'object' || traffic === null || !('direct' in traffic) || !('relayed' in traffic)) {
    throw new Error(`/self reported no two-column split: ${JSON.stringify(body)}`)
  }
  const bytesOf = (leg: unknown, name: string): { bytes: number } => {
    if (typeof leg !== 'object' || leg === null || !('bytes' in leg) || typeof leg.bytes !== 'number') {
      throw new Error(`/self reported a ${name} leg without bytes: ${JSON.stringify(leg)}`)
    }
    return { bytes: leg.bytes }
  }
  if (typeof relayService !== 'object' || relayService === null) {
    throw new Error(`/self reported a relayService that is not an object: ${JSON.stringify(body)}`)
  }
  const source: Record<string, unknown> = { ...relayService }
  const counter = (name: string): number => {
    const read = source[name]
    if (typeof read !== 'number') throw new Error(`/self reported relayService.${name} as ${JSON.stringify(read)}`)
    return read
  }
  const marker = source['firstInboundHopStreamAt']
  if (marker !== undefined && typeof marker !== 'number') {
    throw new Error(`/self reported a non-numeric marker: ${JSON.stringify(marker)}`)
  }
  return {
    peerId,
    traffic: { direct: bytesOf(traffic.direct, 'direct'), relayed: bytesOf(traffic.relayed, 'relayed') },
    relayService: {
      inboundHopStreams: counter('inboundHopStreams'),
      outboundHopStreams: counter('outboundHopStreams'),
      outboundStopStreams: counter('outboundStopStreams'),
      inboundStopStreams: counter('inboundStopStreams'),
      bytes: counter('bytes'),
      firstInboundHopStreamAt: marker,
    },
  }
}

/** A peer that will try to reserve — the one thing `inbound-listener.e2e.test.ts` has none of. */
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

describe('a relay hop stream is recorded, and the record outlives the process that saw it', () => {
  it('goes from nothing recorded, to a hop stream, to a record read back from a NEW process', async () => {
    await startWorker()

    // **Step 1 — nothing recorded.** The whole ordering claim in miniature: the field is a
    // reading before there is anything to read, not a field added once there was.
    //
    // The store is a fresh directory per run — see `PERSIST_DIR`, which exists because the
    // default location is SHARED with `inbound-listener.e2e.test.ts` and this file reddened
    // it. The assertion is kept anyway rather than dropped as guaranteed: it is what would
    // say so out loud if the isolation ever stopped working.
    const before = await readSelf()
    expect(
      before.relayService.firstInboundHopStreamAt,
      `${PERSIST_DIR} already holds a hop-stream marker — this run\'s storage was not isolated`,
    ).toBeUndefined()
    expect(before.relayService.inboundHopStreams).toBe(0)

    // **Step 2 — a peer that carries `circuitRelayTransport` dials and asks for a slot.**
    const client = await reservingClient()
    try {
      await client.dial(multiaddr(`/ip4/${HOST}/tcp/${PORT}/ws/p2p/${before.peerId}`), {
        signal: AbortSignal.timeout(30_000),
      })

      // The hop stream follows the connection, so the reading is taken when it has arrived
      // rather than after a fixed wait.
      const deadline = Date.now() + 30_000
      let during = await readSelf()
      while (during.relayService.inboundHopStreams === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        during = await readSelf()
      }
      expect(during.relayService.inboundHopStreams, 'no hop stream reached the worker').toBeGreaterThan(0)
      expect(during.relayService.firstInboundHopStreamAt).toBeGreaterThan(0)
      // This node was USED as a relay; it used no other. The direction is the meaning.
      expect(during.relayService.outboundHopStreams).toBe(0)
    } finally {
      // **Step 3 — the client goes away, which closes the socket and banks.**
      await client.stop()
    }

    // Give the close handler its write. The bank is `await`ed inside `webSocketClose`, but the
    // socket's close travels the network first.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // **Step 4 — kill workerd and ask a different process.** Every in-memory counter in the
    // old isolate is gone; `.wrangler/state` is not.
    await stopWorker()
    await startWorker()

    const after = await readSelf()
    expect(after.peerId, 'the identity must survive the restart too').toBe(before.peerId)
    // **The answer to the question that started this.** A brand-new process, which has
    // observed nothing, saying when this relay was first used.
    expect(after.relayService.inboundHopStreams).toBeGreaterThan(0)
    expect(after.relayService.firstInboundHopStreamAt).toBeGreaterThan(0)

    // **And the contrast, in the same answer.** The split is per-instance, so it reads zero
    // for a process that has held no connection — while the relay record does not. One
    // reading carrying both is what says the difference is designed.
    expect(after.traffic.direct.bytes).toBe(0)
    expect(after.traffic.relayed.bytes).toBe(0)
  }, 300_000)
})
