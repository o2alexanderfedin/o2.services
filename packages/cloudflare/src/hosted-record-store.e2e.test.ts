/**
 * Phase 31 criterion 1 — the hosted node holds and answers records on `/o2/kad/1.0.0`.
 *
 * ## The shape of the proof, and why the writer is stopped before the reader starts
 *
 * Two ordinary libp2p peers, each dialling **only** the locally-run Durable Object and never
 * each other. Peer A publishes a record for its own node key; **A is then stopped**; peer B
 * asks for that key and gets it back.
 *
 * Stopping A is what makes the phrase *"through the hosted node"* a reading rather than a
 * hope. With both peers up, kad-dht is iterative — B learns A from the object's routing table
 * and may fetch the record from A directly, and the test would pass with the object storing
 * nothing at all. With A gone, the object is the only holder there is.
 *
 * ## What the four settings are doing here, measured rather than restated
 *
 * `protocol` and `clientMode` alone produce a keyspace that is inert in both directions
 * (measured 2026-08-23, `CLAUDE.md`'s kad-dht row). Both remaining settings are load-bearing
 * on exactly this arrangement:
 *
 * - `peerInfoMapper` — the default strips private addresses and `onPeerConnect` drops a peer
 *   left with none. Every address here is `127.0.0.1`, so the default empties the object's
 *   routing table **silently**, and nothing is stored anywhere.
 * - `selectors` — `bestRecord` throws `MissingSelectorError` for an unregistered namespace,
 *   so a keyspace with validators alone accepts every write and errors on every read. A
 *   caller that catches query failures reads that as an empty keyspace.
 *
 * Both were planted in `hosted-libp2p.ts` and watched red against this file; the readings are
 * in `31-01-SUMMARY.md`.
 *
 * ## What this does NOT prove
 *
 * That the writer is a **browser** peer, which is criterion 1's own word. These are Node
 * peers over WebSockets. The browser tier reaches this object over the same transport, and
 * the DHT layer above it is the same code on both tiers — but that is an argument, not a
 * measurement, and it is recorded as the criterion's open half rather than folded into a
 * green.
 *
 * That the DEPLOYED object behaves identically. Local workerd is the same runtime; the edge
 * in front of it is not here.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { kadDHT, passthroughMapper } from '@libp2p/kad-dht'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { publishCapabilities } from '@o2/core'
import type { NodeCertificate } from '@o2/core'
import {
  O2_KAD_PROTOCOL,
  O2_RECORD_NAMESPACE,
  dhtKeyForNodeKey,
  o2RecordSelector,
  o2RecordValidator,
} from '@o2/libp2p'
import { encodeNodeRecords } from '@o2/net'
import { ed25519 } from '@noble/curves/ed25519.js'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from 'libp2p'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const PORT = 8792
const HOST = '127.0.0.1'

let worker: ChildProcess | undefined
let selfReport: { peerId: string; nodeKey: string; instance: string; version: string }

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The certificate signature this fixture does not compute, stated rather than hidden.
 *
 * `o2RecordValidator` checks three things: that the key names the record's subject, that the
 * record decodes, and that the **capability** record's signature verifies. It does not verify
 * the certificate — a disinterested storer holds no issuer set, which is the whole reason the
 * ownable half of the key is the node's own signature over its own claims. So the capability
 * record below is signed for real by the writing peer's seed, and the certificate carries a
 * placeholder of the right width. A fixture that signed the certificate too would be
 * asserting something this keyspace deliberately does not check.
 */
const UNCHECKED_CERTIFICATE_SIGNATURE = '00'.repeat(64)

/**
 * A peer with the same four private-DHT settings the hosted node carries.
 *
 * `clientMode: true`, because these two are transient: leaving it unset would make their DHT
 * role follow the relay's network position, which is the trap `CLAUDE.md` records. The object
 * is the server here and is the only one that needs to be.
 */
async function peer(
  listen: readonly string[] = [],
  selectors: Record<string, typeof o2RecordSelector> = { [O2_RECORD_NAMESPACE]: o2RecordSelector },
): Promise<Libp2p<{ dht: ReturnType<ReturnType<typeof kadDHT>> }>> {
  const node = await createLibp2p({
    addresses: { listen: [...listen] },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      // Required by `kadDHT`'s own components type, which is how this surfaced: without it
      // the service factory does not typecheck against the node it is declared on.
      ping: ping(),
      dht: kadDHT({
        protocol: O2_KAD_PROTOCOL,
        clientMode: true,
        peerInfoMapper: passthroughMapper,
        validators: { [O2_RECORD_NAMESPACE]: o2RecordValidator(() => Date.now()) },
        selectors,
      }),
    },
    connectionManager: { inboundConnectionThreshold: 100, maxIncomingPendingConnections: 100 },
  })
  await node.start()
  return node
}

/** A record for `seed`'s own node key, signed the way the fabric signs one. */
function recordsFor(seed: Uint8Array, now: number): { key: Uint8Array; value: Uint8Array } {
  const nodeKey = toHex(ed25519.getPublicKey(seed))
  const issuer = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
  const unsigned: Omit<NodeCertificate, 'signature'> = {
    nodeKey,
    userKey: issuer,
    operatorId: 'phase-31-e2e',
    discoverability: 'seed',
    relayIds: [],
    issuedAt: now,
    expiresAt: now + 3_600_000,
    issuer,
  }
  const certificate: NodeCertificate = {
    ...unsigned,
    signature: UNCHECKED_CERTIFICATE_SIGNATURE,
  }
  return {
    key: dhtKeyForNodeKey(nodeKey),
    value: encodeNodeRecords({
      certificate,
      capabilities: publishCapabilities(seed, {
        features: [],
        sovereignFor: [],
        issuedAt: now,
        expiresAt: now + 3_600_000,
        extensions: [],
      }),
    }),
  }
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${PORT}/self`, {
        signal: AbortSignal.timeout(3000),
      })
      if (response.ok) {
        selfReport = (await response.json()) as typeof selfReport
        return
      }
      lastError = new Error(`/self answered ${response.status}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within ${timeoutMs} ms: ${String(lastError)}`)
}

beforeAll(async () => {
  worker = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--local-protocol', 'http'], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
    stdio: 'ignore',
  })
  await waitForReady(120_000)
}, 150_000)

afterAll(() => {
  worker?.kill('SIGTERM')
})

describe('HOST-03 — the hosted node holds and answers records on the fabric’s own keyspace', () => {
  it('takes a record from one peer and hands it to a second AFTER the writer has gone', async () => {
    const writer = await peer()
    const reader = await peer()
    const address = multiaddr(`/ip4/${HOST}/tcp/${PORT}/ws/p2p/${selfReport.peerId}`)
    try {
      await writer.dial(address, { signal: AbortSignal.timeout(30_000) })
      await reader.dial(address, { signal: AbortSignal.timeout(30_000) })

      // **A FRESH key every run, and it took a probe to find out why.** `wrangler dev`
      // persists Durable Object storage under `.wrangler/state`, so a record written by an
      // earlier run is still there. With a fixed seed this case passed for the wrong reason
      // twice: the probe that skipped the `put` entirely still got a VALUE back — an older
      // run's record, under the same key, differing only in `issuedAt`. The byte-exact
      // assertion caught it; a `toBeDefined()` would not have.
      const seed = crypto.getRandomValues(new Uint8Array(32))
      const { key, value } = recordsFor(seed, Date.now())

      // `put` yields events; draining it is what awaits the write.
      for await (const _event of writer.services.dht.put(key, value, {
        signal: AbortSignal.timeout(30_000),
      })) {
        // The events are the query's progress. What matters is that it completes.
      }

      // **The writer leaves.** From here the object is the only holder of this record.
      await writer.stop()

      let answered: Uint8Array | undefined
      for await (const event of reader.services.dht.get(key, {
        signal: AbortSignal.timeout(30_000),
      })) {
        if (event.name === 'VALUE') answered = event.value
      }

      expect(answered, 'the hosted node answered no value for a key it was given').toBeDefined()
      // Byte-identical, not merely decodable: the object must return what it was handed.
      expect(answered && toHex(answered)).toBe(toHex(value))
    } finally {
      await Promise.resolve(writer.stop()).catch(() => undefined)
      await reader.stop()
    }
  }, 180_000)
})

describe('HOST-03 — `peerInfoMapper`, and what the default one does silently', () => {
  /**
   * The criterion's first plant, arranged so that it can actually be watched.
   *
   * **A write-then-read through the object does NOT exercise `peerInfoMapper`, and both
   * plants were watched staying green before this case existed.** With one client putting
   * and another getting, each is directly connected to the object and the object answers
   * from its own store — no routing table is consulted, so replacing `passthroughMapper`
   * with the library default changed nothing observable. A green that could not have gone
   * red is what the case above would have been on its own.
   *
   * What the mapper governs is the object's **routing table**: `onPeerConnect` maps a peer's
   * addresses and drops the peer if none survive, and the default strips private ones. Every
   * address here is `127.0.0.1`. So the arrangement that sees it is one where the object has
   * to answer *about a third peer* rather than about a record it holds — which is exactly
   * what `findPeer` asks.
   */
  it('answers for a peer it has only ever seen over a private address', async () => {
    // A holder with a real listen address, so there is something to answer WITH. Everything
    // it announces is loopback, which is what the default mapper removes.
    const holder = await peer(['/ip4/127.0.0.1/tcp/0/ws'])
    const reader = await peer()
    const address = multiaddr(`/ip4/${HOST}/tcp/${PORT}/ws/p2p/${selfReport.peerId}`)
    try {
      await holder.dial(address, { signal: AbortSignal.timeout(30_000) })
      await reader.dial(address, { signal: AbortSignal.timeout(30_000) })
      // identify has to complete before the object knows the holder's addresses at all.
      await new Promise((resolve) => setTimeout(resolve, 2_000))

      // The reader knows the object and nothing else. If the object's routing table is
      // empty, this cannot resolve — and it fails by TIMING OUT rather than by erroring,
      // which is the "silently" in the criterion.
      const found = await reader.peerRouting.findPeer(holder.peerId, {
        signal: AbortSignal.timeout(20_000),
      })

      expect(found.id.toString()).toBe(holder.peerId.toString())
    } finally {
      await holder.stop()
      await reader.stop()
    }
  }, 180_000)
})

describe('HOST-03 — `selectors`, and WHICH node’s selectors decide a read', () => {
  /**
   * **The criterion's second plant is watched here on the reader, and the reason is a
   * correction to the criterion.** It says dropping `selectors` from the hosted node is
   * *"watched throwing `MissingSelectorError` on every read"*. Measured against the library:
   * `bestRecord` — the only thing that throws it — is called from exactly one place,
   * `node_modules/@libp2p/kad-dht/dist/src/content-fetching/index.js:170`, which is the
   * **querying** node's own `getValue`. No RPC handler calls it. So a client reading a record
   * *through* the hosted node never consults the hosted node's selectors, and the plant the
   * criterion describes cannot redden the case above — it was watched staying green there
   * before this case existed.
   *
   * The mechanism is real and the registration is load-bearing; the criterion attributed it
   * to the wrong side. `hosted-libp2p.node.test.ts` asserts the hosted node registers one,
   * which is what matters for the reads the hosted node itself performs.
   *
   * The error is also NOT swallowed, which is worth pinning: `content-fetching` catches it
   * and rethrows unless `err.name === 'InvalidParametersError'`, and this one's `name` is
   * `MissingSelectorError` (`dist/src/errors.js:25`).
   */
  it('throws MissingSelectorError at the READER when the reader registered none', async () => {
    const writer = await peer()
    const reader = await peer([], {})
    const address = multiaddr(`/ip4/${HOST}/tcp/${PORT}/ws/p2p/${selfReport.peerId}`)
    try {
      await writer.dial(address, { signal: AbortSignal.timeout(30_000) })
      await reader.dial(address, { signal: AbortSignal.timeout(30_000) })

      const { key, value } = recordsFor(crypto.getRandomValues(new Uint8Array(32)), Date.now())
      for await (const _event of writer.services.dht.put(key, value, {
        signal: AbortSignal.timeout(30_000),
      })) {
        // Drained; the write completing is the precondition, not the subject.
      }

      const read = async (): Promise<void> => {
        for await (const _event of reader.services.dht.get(key, {
          signal: AbortSignal.timeout(30_000),
        })) {
          // The throw happens as the query resolves its candidates.
        }
      }

      await expect(read()).rejects.toThrow(/MissingSelector|selector/i)
    } finally {
      await writer.stop()
      await reader.stop()
    }
  }, 180_000)
})
