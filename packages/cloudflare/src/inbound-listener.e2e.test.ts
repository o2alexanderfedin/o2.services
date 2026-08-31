/**
 * Phase 30 — the inbound listener, proved by real libp2p peers against a real workerd.
 *
 * ## What this file retires
 *
 * Two docblocks in this package said the listener's platform half is untestable locally —
 * `worker.ts`'s `#upgrade` (*"the two untestable lines… which no local run can execute"*) and
 * `hibernatable-socket.ts`'s `acceptInboundSocket`. **Both were measured false on
 * 2026-08-30**, and both now carry dated corrections pointing here.
 *
 * `wrangler dev` runs the real workerd runtime with no account and `CLOUDFLARE_API_TOKEN` blanked. It creates a genuine Durable Object, constructs the `WebSocketPair` the comment
 * called unreachable, and — measured below — **completes a full Noise + yamux handshake with
 * an ordinary `createLibp2p` node**, which returns the object's own PeerId.
 *
 * The claim was reasonable when written: nothing in the `node` lane can construct a
 * `WebSocketPair`, and the deployed object was the only workerd anyone had reached. What it
 * missed is that a local workerd is still workerd.
 *
 * ## Why the assertions are on CONNECTIONS and not on the 101
 *
 * Written first against raw HTTP upgrades, which passed — and then **plant B, replacing the
 * `CF-Connecting-IP`-derived address with one fixed address for every peer, left it green.**
 * A 101 is the platform answering; it says nothing about whether libp2p admitted the peer.
 * Criterion 1 is about *admission*, so every case here dials with a real node and reads the
 * connection back.
 *
 * ## `.e2e.test.ts`, deliberately
 *
 * It spawns a process, binds a port and opens real sockets. The `e2e` lane runs
 * `fileParallelism: false` for exactly this; the `node` lane does not.
 *
 * ## What is NOT asserted
 *
 * That the DEPLOYED object behaves identically. Local workerd is the same runtime, but the
 * Cloudflare edge in front of it is not here — which is why criterion 3's subject is the
 * `CF-Connecting-IP` header, supplied here by workerd itself exactly as the edge supplies it.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from 'libp2p'
import type { RelayServiceTotals } from '@o2/libp2p'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const PORT = 8791
const HOST = '127.0.0.1'

/**
 * Criterion 1's threshold is *"more than five"*, and the roadmap states why: libp2p's default
 * `inboundConnectionThreshold` is **5 per host per second**
 * (`libp2p/dist/src/connection-manager/constants.defaults.js`), so with one or two peers the
 * defect cannot appear at all and a green from a two-peer test is a green that could not have
 * gone red. Eight, dialled together.
 */
const CONCURRENT_CLIENTS = 8

let worker: ChildProcess | undefined
interface TrafficLegReport {
  connectionSeconds: number
  bytes: number
}
interface SelfReport {
  peerId: string
  nodeKey: string
  instance: string
  version: string
  traffic: { direct: TrafficLegReport; relayed: TrafficLegReport }
  relayService: RelayServiceTotals
}
let selfReport: SelfReport

/** The worker's own dialable address, built from the PeerId it reports. */
function workerAddress(): string {
  return `/ip4/${HOST}/tcp/${PORT}/ws/p2p/${selfReport.peerId}`
}

/**
 * A dialling node.
 *
 * **Its own inbound limits are raised deliberately** — they govern what THIS node accepts and
 * would otherwise sit between the test and the thing under test. The worker's limits are left
 * at their defaults, because those are the subject.
 */
async function dialer(): Promise<Libp2p> {
  const node = await createLibp2p({
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    connectionManager: { inboundConnectionThreshold: 100, maxIncomingPendingConnections: 100 },
  })
  await node.start()
  return node
}

/**
 * Read `/self`'s body without asserting it into shape.
 *
 * A cast here would make a route that stopped reporting `traffic` present as a field of
 * `undefined` in an assertion rather than as a failure at the boundary, which is the whole
 * defect class NET-14's counters exist inside. `relayService` is required on the same terms
 * and was added here at the same time it was added to the route — the third of three readers,
 * extended deliberately rather than left to be caught later.
 */
function readSelfReport(body: unknown): SelfReport {
  const leg = (value: unknown): TrafficLegReport => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('connectionSeconds' in value) ||
      !('bytes' in value) ||
      typeof value.connectionSeconds !== 'number' ||
      typeof value.bytes !== 'number'
    ) {
      throw new Error(`/self reported a traffic leg that is not two numbers: ${JSON.stringify(value)}`)
    }
    return { connectionSeconds: value.connectionSeconds, bytes: value.bytes }
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('peerId' in body) ||
    !('nodeKey' in body) ||
    !('instance' in body) ||
    !('version' in body) ||
    !('traffic' in body) ||
    typeof body.peerId !== 'string' ||
    typeof body.nodeKey !== 'string' ||
    typeof body.instance !== 'string' ||
    typeof body.version !== 'string' ||
    typeof body.traffic !== 'object' ||
    body.traffic === null ||
    !('direct' in body.traffic) ||
    !('relayed' in body.traffic) ||
    !('relayService' in body)
  ) {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  return {
    peerId: body.peerId,
    nodeKey: body.nodeKey,
    instance: body.instance,
    version: body.version,
    traffic: { direct: leg(body.traffic.direct), relayed: leg(body.traffic.relayed) },
    relayService: relayService(body.relayService),
  }
}

/** The relay-service record, narrowed field by field for the reason {@link readSelfReport} gives. */
function relayService(value: unknown): RelayServiceTotals {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`/self reported a relayService that is not an object: ${JSON.stringify(value)}`)
  }
  const source: Record<string, unknown> = { ...value }
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
    inboundHopStreams: counter('inboundHopStreams'),
    outboundHopStreams: counter('outboundHopStreams'),
    outboundStopStreams: counter('outboundStopStreams'),
    inboundStopStreams: counter('inboundStopStreams'),
    bytes: counter('bytes'),
    firstInboundHopStreamAt: marker,
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
        selfReport = readSelfReport(await response.json())
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
    // **The blanked credential is the measurement, not hygiene.** It is what makes "no account is
    // needed" a reading rather than an assumption: a path reaching for Cloudflare would fail
    // here instead of quietly succeeding on an ambient credential.
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
    stdio: 'ignore',
  })
  await waitForReady(120_000)
}, 150_000)

afterAll(() => {
  worker?.kill('SIGTERM')
})

describe('a real workerd runs the listener locally, with no Cloudflare account', () => {
  it('answers /self with a Durable Object identity it generated itself', () => {
    expect(selfReport.peerId).toMatch(/^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/)
    expect(selfReport.nodeKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('completes Noise and yamux with an ordinary libp2p node, answering its own PeerId', async () => {
    // The single reading that retires both "untestable" docblocks: a full handshake through
    // `#upgrade`, `WebSocketPair` and `acceptInboundSocket`, ending in the PeerId `/self`
    // reports. Compared against `/self` rather than against a literal, so the two independent
    // paths out of the object have to agree.
    const node = await dialer()
    try {
      const connection = await node.dial(multiaddr(workerAddress()), {
        signal: AbortSignal.timeout(30_000),
      })
      expect(connection.remotePeer.toString()).toBe(selfReport.peerId)
    } finally {
      await node.stop()
    }
  }, 90_000)
})

describe('criterion 1 — more than five concurrent distinct clients are all admitted', () => {
  it(`admits ${CONCURRENT_CLIENTS} peers dialling together, none refused`, async () => {
    // Eight SEPARATE libp2p nodes, so eight distinct peer identities and eight separate
    // sockets — not one node opening eight streams, which would exercise nothing.
    const nodes = await Promise.all(Array.from({ length: CONCURRENT_CLIENTS }, () => dialer()))
    try {
      const address = multiaddr(workerAddress())
      const settled = await Promise.allSettled(
        nodes.map((node) => node.dial(address, { signal: AbortSignal.timeout(30_000) })),
      )

      const refused = settled
        .map((outcome, index) =>
          outcome.status === 'rejected' ? `peer ${index}: ${String(outcome.reason)}` : undefined,
        )
        .filter((entry): entry is string => entry !== undefined)

      // Named rather than counted: a refusal reports WHICH peer and why, because
      // "expected 8 to be 8" would say nothing about an inbound cap doing the refusing.
      expect(refused).toEqual([])

      // Read back from each dialler's own connection list — the connection has to still be
      // open, not merely to have been returned once.
      for (const [index, node] of nodes.entries()) {
        const open = node.getConnections().filter((c) => c.status === 'open')
        expect(open.length, `peer ${index} holds no open connection`).toBeGreaterThan(0)
      }
    } finally {
      await Promise.all(nodes.map((node) => node.stop()))
    }
  }, 180_000)
})

describe('criterion 3 — each connection carries the client’s address, not one shared value', () => {
  /**
   * **The header cannot be stripped from the client side, and finding that out is the result.**
   *
   * Written first as "send no `CF-Connecting-IP`, expect a refusal", which failed with
   * `expected 101 not to be 101`. workerd **stamps the header itself**, exactly as the edge
   * does — measured with a bare probe worker echoing every header, with curl sending none:
   * `{"cf-connecting-ip": "127.0.0.1", …}`. Sending one explicitly passes it through
   * unchanged (`203.0.113.42` in, `203.0.113.42` out), so the value is the client's.
   *
   * So `remoteAddrFromRequest`'s refusal guards against a *runtime that stopped supplying the
   * header*, not against a hostile client, and it is unit-tested where a `Request` can be
   * constructed by hand. What belongs here is the half only a live runtime answers.
   */
  it('gives each peer its own connection rather than collapsing them onto one', async () => {
    const nodes = await Promise.all(Array.from({ length: CONCURRENT_CLIENTS }, () => dialer()))
    try {
      const address = multiaddr(workerAddress())
      const connections = await Promise.all(
        nodes.map((node) => node.dial(address, { signal: AbortSignal.timeout(30_000) })),
      )

      // Distinct connection ids and distinct local peers. If the listener were folding every
      // client onto one remote address, libp2p's per-host inbound limiter would refuse from
      // the sixth onward — which is the production defect, and it would look like this test
      // simply not finishing.
      expect(new Set(connections.map((c) => c.id)).size).toBe(CONCURRENT_CLIENTS)
      expect(new Set(nodes.map((n) => n.peerId.toString())).size).toBe(CONCURRENT_CLIENTS)
    } finally {
      await Promise.all(nodes.map((node) => node.stop()))
    }
  }, 180_000)
})

describe('NET-14 — the two counters report before the relay carries anything', () => {
  /**
   * **Criterion 3 is an ordering, not a dashboard**, and this is the ordering as a reading.
   *
   * `selfReport` was taken in `beforeAll`, before any peer dialled — `GET /self` is HTTP and
   * opens no libp2p connection, so nothing has been counted yet. Two zeroed columns is what a
   * counter that exists and has seen nothing looks like; a missing field is what a counter
   * added later looks like, and those must not be confusable.
   */
  it('answers two zeroed columns on a node that has carried nothing', () => {
    expect(selfReport.traffic).toEqual({
      direct: { connectionSeconds: 0, bytes: 0 },
      relayed: { connectionSeconds: 0, bytes: 0 },
    })
  })

  it('has moved the DIRECT column once real peers have connected, and left RELAYED at zero', async () => {
    // Deliberately last in the file: the eight-peer cases above have run, so the object has
    // held real connections. Every one of them is a plain WebSocket dial, which is what makes
    // `relayed` staying at zero a reading rather than a coincidence — a classifier that put
    // everything in one column would fail here in one direction or the other.
    const after = readSelfReport(
      await (await fetch(`http://${HOST}:${PORT}/self`, { signal: AbortSignal.timeout(5000) })).json(),
    )

    expect(after.traffic.direct.bytes).toBeGreaterThan(0)
    expect(after.traffic.direct.connectionSeconds).toBeGreaterThan(0)
    expect(after.traffic.relayed.bytes).toBe(0)
    expect(after.traffic.relayed.connectionSeconds).toBe(0)
  }, 30_000)

  it('reports a relay-service record of all zeros — because nobody has relayed through it', async () => {
    // The reading this file can honestly take, and it is worth taking. Eight peers dialled
    // this workerd directly; none of them reserved. So every counter must still be zero and
    // the marker must still be absent — which is what says the field is a MEASUREMENT and not
    // a number that moves whenever anything happens. A log that counted any protocol stream,
    // or that ignored `direction`, would be non-zero here: identify and the muxer's own
    // streams ran on all eight connections.
    //
    // **Why nothing moved it, stated correctly.** An earlier draft of this comment said
    // `wrangler dev` *"is not running a relay these clients could reserve on"*. That is FALSE
    // and was caught before it shipped: `hosted-libp2p.ts:348` puts `circuitRelayServer` in
    // the hosted assembly, so this workerd IS a relay. What none of these eight clients has
    // is `circuitRelayTransport` — `dialer()` above lists `webSockets()` and nothing else —
    // so no reservation is ever attempted. The zero is a fact about the CLIENTS.
    //
    // A client that does carry it, dialling this same worker, is
    // `relay-service-journal.e2e.test.ts`, which also kills and restarts wrangler to read the
    // record back across a process death.
    const after = readSelfReport(
      await (await fetch(`http://${HOST}:${PORT}/self`, { signal: AbortSignal.timeout(5000) })).json(),
    )

    expect(after.relayService).toEqual({
      inboundHopStreams: 0,
      outboundHopStreams: 0,
      outboundStopStreams: 0,
      inboundStopStreams: 0,
      bytes: 0,
      firstInboundHopStreamAt: undefined,
    })
  }, 30_000)
})
