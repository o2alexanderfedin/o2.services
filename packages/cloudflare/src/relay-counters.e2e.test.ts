/**
 * BENCH-06 — what `traffic.relayed` and `relayService.inboundHopStreams` actually count on a
 * node in the relay role, read off a running workerd rather than inferred from the source.
 *
 * ## The anomaly this file exists to measure
 *
 * `GET /self` on the deployed node answered, read live 2026-09-04:
 *
 * ```
 * "traffic":{"direct":{"connectionSeconds":39178.906,"bytes":15958472},
 *            "relayed":{"connectionSeconds":0,"bytes":0}},
 * "relayService":{"inboundHopStreams":6715,"outboundHopStreams":0,"outboundStopStreams":53,
 *                 "inboundStopStreams":0,"bytes":1793363,"firstInboundHopStreamAt":1788191433180}
 * ```
 *
 * **6 715 inbound hop streams against zero relayed connection-seconds and zero relayed bytes.**
 * A relay that is plainly being used, reporting no relayed traffic at all. That pair bears on
 * Phase 39 criterion 4, which is a count of participants: a participant count read off a
 * counter that does not move is not a count.
 *
 * This file does not explain the pair from the source. It reproduces the arrangement locally —
 * one workerd, one reserver, one seeker, one relayed exchange — and takes the reading at four
 * moments, so every number below is a delta *within one run* rather than an absolute sited
 * against this machine.
 *
 * ## Why four readings and not two
 *
 * R0 cold, R1 after a reservation, R2 after a relayed exchange, R3 after both clients stop.
 * The pairs are what carry meaning: R2 − R0 on `direct.connectionSeconds` is the floor that
 * says the instrument is alive at all, without which a run where nothing connected would
 * satisfy the `relayed` reading perfectly and prove nothing. R3 distinguishes a
 * connection-seconds figure that accrues live from one that only banks at close.
 *
 * ## The scope fence, and it is the reason for two settings below
 *
 * Nothing here touches the deployed object. `CLOUDFLARE_API_TOKEN` is blanked so a path
 * reaching for Cloudflare fails here rather than quietly succeeding, and
 * **`ANNOUNCE_MULTIADDRS` is overridden to this run's own loopback address**. That second one
 * is not tidiness: `wrangler.jsonc` announces `/dns4/<the deployed host>/tcp/443/tls/ws`, and a
 * local relay left at that value hands its reserving client a circuit address pointing at the
 * **production node**. `--var` merges with the file's `vars` rather than replacing them
 * (measured 2026-08-27, recorded on `HostedEnv.O2_VERSION`), so overriding this one key leaves
 * the rest intact.
 *
 * ## Its own port and its own `--persist-to`
 *
 * `relay-service-journal.e2e.test.ts` records the measurement that makes this mandatory: two
 * e2e files sharing `<cwd>/.wrangler/state` read each other's history and reddened each other
 * here once. The `e2e` lane's `fileParallelism: false` is a discipline, not a guarantee.
 *
 * ## The plant, watched red — 2026-09-07
 *
 * `runOnLimitedConnection: true` was removed from the reserver's `handle()` registration, one
 * line, restored afterwards by the inverse of that edit with `cmp` silent against a snapshot
 * taken immediately before. The run went from `1 passed` to `1 failed` and the red arrives
 * **before** any assertion, verbatim:
 *
 * ```
 * StreamResetError: The stream has been reset
 *  ❯ YamuxStream.onRemoteReset node_modules/@libp2p/utils/src/abstract-message-stream.ts:358:16
 * ```
 *
 * That is the reserver aborting the inbound stream — `connection.js:180` reads the registrar's
 * options, throws `LimitedConnectionError` when the connection reports limits, and the muxer
 * resets — reaching the dialler as a remote reset. Only `R0` and `R1` printed; `R2` and `R3`
 * were never taken.
 *
 * **The red is what proves the path is relayed.** A connection with no limits runs every
 * handler regardless of the flag, so this plant could only fail on a connection libp2p
 * considers limited. The `[BENCH-06 arrangement]` line records the same fact from the other
 * side: `limits={}` — an empty object, which is not null, which is what
 * `this.limits != null` tests.
 *
 * ## What this file does NOT claim
 *
 * That the deployed node's zero has the same cause as this one's. It reproduces a *shape* on a
 * different host with two clients instead of thousands; whether the deployed object ever held a
 * connection this classifier would have called relayed is not observable from here.
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

/**
 * The identity secret this spec's local `wrangler dev` boots with — AUTH-07 criterion 4.
 *
 * Per-spec test data rather than a shared constant, in the style of the two files this
 * arrangement is built from: this spec passes its own `--persist-to`, so the value only has to
 * be self-consistent across its own boots. The length IS load bearing — under twenty characters
 * `assertUsablePassphrase` refuses and every boot below fails with `WeakPassphraseError`.
 */
const SECRET = 'local-dev-identity-secret-42'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const PORT = 8824
const HOST = '127.0.0.1'

/** See the header: never the deployed host, and never derived from `wrangler.jsonc`. */
const LOCAL_ANNOUNCE = `/ip4/${HOST}/tcp/${String(PORT)}/ws`

/** This file's own Durable Object storage — see the header. */
const PERSIST_DIR = mkdtempSync(join(tmpdir(), 'o2-relay-counters-'))

/**
 * The probe protocol, registered and dialled inside this file rather than borrowed.
 *
 * `Libp2pTransport` would carry the exchange too, and is deliberately not used: this plan's
 * plant is the removal of `runOnLimitedConnection: true` from the registration, and that flag
 * lives in shared source there. Planting into shared source is what the tree's concurrency
 * conventions forbid. A hand-rolled handler puts the flag in a file this run owns outright, and
 * additionally keeps NET-13's send budget — which `Libp2pTransport.send` enforces — out of a
 * measurement about counters.
 */
const PROBE_PROTOCOL = '/o2/bench06-probe/1.0.0'

/**
 * Payload in each direction. Small on purpose.
 *
 * Circuit Relay v2's data limit is enforced **bidirectionally** — this tier sets
 * `defaultDataLimit` to 131 072 bytes, and out-plus-back is charged against the one budget, so
 * the usable figure is 64 KiB each way. 4 KiB leaves the negotiation, the Noise handshake and
 * the muxer framing that also ride the circuit an enormous margin, because a cut circuit would
 * present as a counter that did not move and would be read as a finding.
 */
const PAYLOAD_BYTES = 4096

let worker: ChildProcess | undefined

afterAll(() => {
  worker?.kill('SIGTERM')
  rmSync(PERSIST_DIR, { recursive: true, force: true })
})

/** Start `wrangler dev` and wait until `/self` answers. */
async function startWorker(): Promise<void> {
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      '--var',
      `O2_IDENTITY_SECRET:${SECRET}`,
      '--var',
      `ANNOUNCE_MULTIADDRS:${LOCAL_ANNOUNCE}`,
      '--persist-to',
      PERSIST_DIR,
    ],
    {
      cwd: PACKAGE_DIR,
      // Blanked so a path reaching for Cloudflare fails here rather than quietly succeeding
      // against the owner's account.
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  const deadline = Date.now() + 120_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${String(PORT)}/self`, { signal: AbortSignal.timeout(3000) })
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

/** One leg of the split, narrowed rather than cast. */
interface TrafficLegReading {
  connectionSeconds: number
  bytes: number
}

interface SelfReading {
  peerId: string
  traffic: { direct: TrafficLegReading; relayed: TrafficLegReading }
  relayService: RelayServiceTotals
}

/**
 * Read `/self`, refusing a body this file cannot narrow.
 *
 * Field by field on `relay-service-journal.e2e.test.ts`'s stated reason, and one field wider:
 * `connectionSeconds` is narrowed here as well as `bytes`, because the anomaly is a *pair* of
 * zeros and a route that stopped reporting one of them would present as a node that had never
 * carried the thing, which is the exact false reading this file exists to prevent.
 *
 * **Nothing derived from the request is read.** A local `workerd` fills `request.cf` and
 * `CF-Connecting-IP` from the host's real public address; no reading taken here comes from
 * either, and no remote address is logged (T-39-14).
 */
async function readSelf(): Promise<SelfReading> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/self`, { signal: AbortSignal.timeout(5000) })
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
  const legOf = (leg: unknown, name: string): TrafficLegReading => {
    if (
      typeof leg !== 'object' ||
      leg === null ||
      !('bytes' in leg) ||
      typeof leg.bytes !== 'number' ||
      !('connectionSeconds' in leg) ||
      typeof leg.connectionSeconds !== 'number'
    ) {
      throw new Error(`/self reported a ${name} leg this test cannot read: ${JSON.stringify(leg)}`)
    }
    return { connectionSeconds: leg.connectionSeconds, bytes: leg.bytes }
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
    traffic: { direct: legOf(traffic.direct, 'direct'), relayed: legOf(traffic.relayed, 'relayed') },
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

/**
 * One reading, printed.
 *
 * Exactly four of these lines are emitted per run, one per reading point, and they are the
 * numbers `39-COUNTER-READING.md` transcribes rather than re-derives — so the document's
 * section 1 can be checked byte-for-byte against a recorded run instead of trusted.
 */
function logReading(label: string, reading: SelfReading): void {
  const { direct, relayed } = reading.traffic
  const relay = reading.relayService
  console.log(
    `[BENCH-06 counters] ${label} ` +
      `direct.connectionSeconds=${String(direct.connectionSeconds)} direct.bytes=${String(direct.bytes)} ` +
      `relayed.connectionSeconds=${String(relayed.connectionSeconds)} relayed.bytes=${String(relayed.bytes)} ` +
      `inboundHopStreams=${String(relay.inboundHopStreams)} outboundHopStreams=${String(relay.outboundHopStreams)} ` +
      `outboundStopStreams=${String(relay.outboundStopStreams)} inboundStopStreams=${String(relay.inboundStopStreams)} ` +
      `relayService.bytes=${String(relay.bytes)}`,
  )
}

/**
 * The peer that reserves a slot and answers the probe.
 *
 * `runOnLimitedConnection: true` is the registration property under test. Without it libp2p
 * refuses the inbound stream on a limited connection by name — `connection.js:180` reads the
 * registrar's options and throws `LimitedConnectionError` — so a relayed peer connects and
 * still cannot speak the protocol.
 */
async function reservingClient(): Promise<Libp2p> {
  const node = await createLibp2p({
    addresses: { listen: ['/p2p-circuit'] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  await node.start()
  await node.handle(
    PROBE_PROTOCOL,
    async (stream) => {
      let received = 0
      for await (const chunk of stream) {
        received += chunk.byteLength
      }
      // Echoed at a fixed size rather than reflecting what arrived: the reply has to be a
      // number this file states, or a short read would silently shrink the far half of the
      // exchange and the relay's byte reading with it.
      stream.send(new Uint8Array(PAYLOAD_BYTES).fill(received & 0xff))
      await stream.close()
    },
    { runOnLimitedConnection: true },
  )
  return node
}

/** The peer that dials the reserver **through** the circuit. */
async function seekingClient(): Promise<Libp2p> {
  const node = await createLibp2p({
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  await node.start()
  return node
}

describe('what the two counters move on, measured across one relayed connection', () => {
  it('reads traffic.relayed and relayService across cold, reserved, relayed and stopped', async () => {
    await startWorker()

    // ---- R0: cold. No client exists; `/self` is an HTTP route, not a libp2p connection. ----
    const r0 = await readSelf()
    logReading('R0 cold', r0)
    const relayAddr = multiaddr(`/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${r0.peerId}`)

    const reserver = await reservingClient()
    const seeker = await seekingClient()
    let r1: SelfReading
    let r2: SelfReading
    try {
      await reserver.dial(relayAddr, { signal: AbortSignal.timeout(30_000) })

      // **Gated on the reservation being GRANTED, not on a counter moving.**
      // `relay-service-journal.e2e.test.ts`'s header is explicit that a hop stream is not a
      // granted reservation — the wire cannot tell RESERVE from CONNECT — so waiting on
      // `inboundHopStreams` would both race the circuit dial and make R1 a function of the
      // number R1 is about to be compared against. The client-side signal is independent:
      // the circuit transport only publishes a `/p2p-circuit` address once it holds a slot.
      const reservedBy = Date.now() + 60_000
      while (
        !reserver.getMultiaddrs().some((addr) => addr.toString().includes('/p2p-circuit')) &&
        Date.now() < reservedBy
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      const circuitAddrs = reserver.getMultiaddrs().map((addr) => addr.toString())
      expect(
        circuitAddrs.some((addr) => addr.includes('/p2p-circuit')),
        `the reserver holds no circuit address after 60 s, so nothing below is a relayed ` +
          `reading. It advertises: ${JSON.stringify(circuitAddrs)}`,
      ).toBe(true)

      // ---- R1: a reservation exists, nothing has been carried through it. ----
      r1 = await readSelf()
      logReading('R1 reserved', r1)

      // **Built here rather than taken from `getMultiaddrs()`, and without `/webrtc`.** The
      // rendezvous form this tree already builds ends `/p2p-circuit/webrtc/p2p/<peer>`, which
      // is a signalling address whose data path leaves the relay — precisely the connection
      // `classifyConnection` calls `direct`. The measurement needs the data path to STAY on
      // the relay, so the address is the bare circuit form.
      const throughCircuit = multiaddr(
        `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${r0.peerId}/p2p-circuit/p2p/${reserver.peerId.toString()}`,
      )
      const stream = await seeker.dialProtocol(throughCircuit, PROBE_PROTOCOL, {
        runOnLimitedConnection: true,
        signal: AbortSignal.timeout(60_000),
      })

      // Recorded rather than asserted, and it is the reading that says whether the plant below
      // can fail: `runOnLimitedConnection` is only consulted when the connection reports
      // limits. A relayed connection whose `limits` is undefined would make the plant green
      // for a reason that is about the library, not about this arrangement.
      const relayedConn = seeker
        .getConnections(reserver.peerId)
        .find((conn) => conn.remoteAddr.toString().includes('/p2p-circuit'))
      console.log(
        `[BENCH-06 arrangement] seeker->reserver relayed connection present=` +
          `${String(relayedConn !== undefined)} limits=${JSON.stringify(relayedConn?.limits ?? null)}`,
      )

      stream.send(new Uint8Array(PAYLOAD_BYTES).fill(7))
      // Half-close: the write end goes, the read end stays open until the reserver closes its
      // own. That is what lets the handler's `for await` terminate and reply on one stream.
      await stream.close({ signal: AbortSignal.timeout(30_000) })
      let echoed = 0
      for await (const chunk of stream) {
        echoed += chunk.byteLength
      }
      expect(
        echoed,
        `the relayed exchange returned ${String(echoed)} bytes, not ${String(PAYLOAD_BYTES)} — ` +
          'the far half of the circuit did not complete, so every counter below was read ' +
          'against an exchange that only went one way',
      ).toBe(PAYLOAD_BYTES)

      // ---- R2: bytes have crossed the relay in both directions. ----
      //
      // No poll before this read, deliberately. The relay forwards synchronously inside its
      // own isolate, so the reply arriving at the seeker is proof the relay has already run
      // both byte wrappers; and polling until `relayService.bytes` exceeded R1 would make
      // assertion 4 assert its own loop condition.
      r2 = await readSelf()
      logReading('R2 relayed', r2)
    } finally {
      await seeker.stop()
      await reserver.stop()
    }

    // The close travels the network before the counter banks it — the same 2 s settle
    // `relay-service-journal.e2e.test.ts` gives its close handler.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // ---- R3: both clients gone. ----
    const r3 = await readSelf()
    logReading('R3 stopped', r3)

    // ---- 1. The relay was used as a relay. ----
    expect(
      r2.relayService.inboundHopStreams,
      `inboundHopStreams was ${String(r0.relayService.inboundHopStreams)} at R0 and ` +
        `${String(r2.relayService.inboundHopStreams)} at R2 — no peer opened a hop stream, so ` +
        'nothing below is a reading about a relay',
    ).toBeGreaterThan(r0.relayService.inboundHopStreams)

    // ---- 2. THE POSITIVE CONTROL. ----
    //
    // Without this, a run in which nothing ever connected satisfies assertion 3 perfectly. A
    // `relayed` zero is a measurement only because a `direct` non-zero was observed in the
    // same run, on the same instrument, at the same four moments.
    expect(
      r2.traffic.direct.connectionSeconds,
      `direct.connectionSeconds was ${String(r0.traffic.direct.connectionSeconds)} at R0 and ` +
        `${String(r2.traffic.direct.connectionSeconds)} at R2. The split reports nothing on ` +
        'either leg, so it is not an instrument that read zero — it is an instrument that is ' +
        'not reading',
    ).toBeGreaterThan(r0.traffic.direct.connectionSeconds)

    // ---- 3. THE READING. ----
    //
    // **This assertion is a recording of a measurement, not a specification.** It was written
    // to what the run showed, and if the code under it changes so that a relay does report
    // relayed traffic, this line SHOULD go red — that is a finding, not a regression, and the
    // failure message carries every number needed to write the new one.
    //
    // What was observed: `traffic.relayed` stayed at 0 connection-seconds and 0 bytes at all
    // four points, while the same node carried a relayed exchange between two peers and
    // counted it under `relayService`. That is the deployed 2026-09-04 shape — 6 715 hop
    // streams against 0/0 — reproduced locally with two clients.
    const relayedAcross = [r0, r1, r2, r3].map((reading) => reading.traffic.relayed)
    expect(
      relayedAcross,
      `traffic.relayed across R0..R3 was ${JSON.stringify(relayedAcross)} while ` +
        `relayService went from ${String(r0.relayService.inboundHopStreams)} to ` +
        `${String(r3.relayService.inboundHopStreams)} inbound hop streams and from ` +
        `${String(r0.relayService.bytes)} to ${String(r3.relayService.bytes)} bytes. If the ` +
        'relayed leg has started to move, the deployed zero is a NEW open question and this ' +
        'line is the place it surfaces',
    ).toEqual([
      { connectionSeconds: 0, bytes: 0 },
      { connectionSeconds: 0, bytes: 0 },
      { connectionSeconds: 0, bytes: 0 },
      { connectionSeconds: 0, bytes: 0 },
    ])

    // ---- 4. The relay counted what it carried. ----
    //
    // Stated as a delta and reported with the payload beside it, because the delta is NOT
    // wholly the forwarded payload: the CONNECT hop stream's own protobuf is on the same
    // counter. A delta at or above 2 × PAYLOAD_BYTES is what says the spliced traffic itself
    // was counted rather than only the control exchange that set it up.
    expect(
      r2.relayService.bytes,
      `relayService.bytes was ${String(r1.relayService.bytes)} at R1 and ` +
        `${String(r2.relayService.bytes)} at R2, a delta of ` +
        `${String(r2.relayService.bytes - r1.relayService.bytes)} against a ` +
        `${String(PAYLOAD_BYTES)}-byte payload in each direction`,
    ).toBeGreaterThan(r1.relayService.bytes)
  }, 300_000)
})
