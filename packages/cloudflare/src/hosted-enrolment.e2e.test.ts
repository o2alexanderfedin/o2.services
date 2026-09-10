import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { ed25519 } from '@noble/curves/ed25519.js'
import { createLibp2p } from 'libp2p'
import type { Libp2p } from 'libp2p'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Libp2pTransport } from '@o2/libp2p'
import { RpcEndpoint, enrolOverRpc } from '@o2/net'
import { requestEnrollment, toHex } from '@o2/core'
import type { NodeCertificate } from '@o2/core'
import { turnMintPayload } from './turn-credential.ts'

/**
 * THE WHOLE CHAIN, END TO END — AUTH-01 joined to NET-12, against a real workerd.
 *
 * ## What this file exists to settle
 *
 * On 2026-09-09 the TURN rung was found unreachable by every visitor to the published page, and
 * the last and largest reason was that **the gate admits by certificate and no visitor could
 * obtain one**: this tier ran no enrolment authority, so `bootstrap.json` named no provider and
 * a tab sent `certificate: null`. Posted to the live route, that answered `400`.
 *
 * Every part of the fix is unit-tested separately, and separately they prove nothing about the
 * thing the owner actually decided. This spec is the join, in one run, in this order:
 *
 *   1. a node that holds no certificate **enrols over libp2p** against a local workerd;
 *   2. the certificate it gets back names that workerd as its issuer;
 *   3. that certificate is presented to `POST /turn-credential` on the **same** object, and a
 *      credential comes back — the object trusting what it itself signed, derived rather than
 *      configured;
 *   4. and the throttle stops the next one, because the budget is set to what arm 1 spends.
 *
 * Arm 4 is the owner's instruction measured rather than configured: *«throttle на выдачу
 * сертификатов… глобальный, вне зависимости от того, кто зашёл»*. It asks under a **different**
 * user key, because a per-user limit would grant it.
 *
 * ## It dials nobody
 *
 * The TURN provider is the loopback stub `turn-provider-join.e2e.test.ts` established, so no
 * arm here reaches `rtc.live.cloudflare.com` — the rule `hermetic-fixtures.node.test.ts` holds
 * and which a node-lane spec had already broken once this week. `CLOUDFLARE_API_TOKEN` is
 * blanked, metrics are off, `--persist-to` is a fresh directory removed in teardown.
 */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'
/** Its own ports — the other hosted e2e specs hold 8794, 8814 and 8816. */
const PORT = 8818
const STUB_PORT = 8819

const SECRET = 'local-dev-identity-secret-enrolment-join'
/** Two certificates, which is exactly what arm 1 and arm 4 spend between them. */
const BUDGET = 1

const NODE_SEED = new Uint8Array(32).fill(61)
const USER_SEED = new Uint8Array(32).fill(67)
const OTHER_USER_SEED = new Uint8Array(32).fill(71)

const STUB_URLS = ['turn:a-provider-endpoint.invalid:3478?transport=udp']

let worker: ChildProcess | undefined
let stub: Server | undefined
let persistDir = ''

async function joiner(): Promise<{ node: Libp2p; rpc: RpcEndpoint }> {
  const node = await createLibp2p({
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  await node.start()
  return { node, rpc: new RpcEndpoint(await Libp2pTransport.start(node), { timeoutMs: 20_000 }) }
}

async function self(): Promise<Record<string, unknown>> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/self`, {
    signal: AbortSignal.timeout(10_000),
  })
  return (await response.json()) as Record<string, unknown>
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${String(PORT)}/self`, {
        signal: AbortSignal.timeout(3000),
      })
      if (response.ok) return
      lastError = new Error(`/self answered ${String(response.status)}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`)
}

/** Enrol one node/user pair against the hosted provider, the way `browser-node.ts` does. */
async function enrol(
  userSeed: Uint8Array,
  provider: string,
  rpc: RpcEndpoint,
): Promise<{ ok: boolean; certificate?: NodeCertificate; reason: string }> {
  const pending = await requestEnrollment(NODE_SEED, userSeed, {
    operatorId: 'phase-39-enrolment-join',
    discoverability: 'via-relay',
    relayIds: [],
  })
  const outcome = await enrolOverRpc(rpc, provider, pending)
  return outcome.ok
    ? { ok: true, certificate: outcome.certificate, reason: '' }
    : { ok: false, reason: outcome.reason }
}

/** Ask for a TURN credential exactly as a tab does, with the certificate just obtained. */
async function askForTurn(
  certificate: NodeCertificate,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const nodeKey = toHex(ed25519.getPublicKey(NODE_SEED))
  const region = 'bootstrap-us'
  const requestedAt = Date.now()
  const response = await fetch(`http://${HOST}:${String(PORT)}/turn-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      certificate,
      nodeKey,
      region,
      requestedAt,
      signature: toHex(ed25519.sign(turnMintPayload(nodeKey, region, requestedAt), NODE_SEED)),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  stub = createServer((_request, response) => {
    response.writeHead(201, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        iceServers: [
          { urls: ['stun:a-provider-endpoint.invalid:3478'] },
          { urls: STUB_URLS, username: 'a-provider-username', credential: 'a-provider-credential' },
        ],
      }),
    )
  })
  await new Promise<void>((resolve) => stub?.listen(STUB_PORT, HOST, resolve))

  persistDir = mkdtempSync(join(tmpdir(), 'o2-enrolment-join-'))
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
      '--persist-to',
      persistDir,
      // AUTH-01's on-switch. Nothing else turns issuance on, which is the point of it.
      '--var',
      `O2_MAX_ISSUED_PER_WINDOW:${String(BUDGET)}`,
      // NET-12, provider-backed and pointed at the loopback stub above.
      '--var',
      'O2_TURN_KEY_ID:a-key-id',
      '--var',
      'O2_TURN_API_SECRET:a-credential',
      '--var',
      `O2_TURN_API_BASE:http://${HOST}:${String(STUB_PORT)}/v1/turn/keys`,
      // DELIBERATELY NO `O2_TRUSTED_ISSUERS`. The object must trust what it itself signs, and
      // it must do so by derivation — a configured value here would make arm 3 pass on a
      // transcription rather than on the property.
    ],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  await waitForReady(120_000)
}, 150_000)

afterAll(async () => {
  worker?.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    if (stub === undefined) return resolve()
    stub.close(() => resolve())
  })
  if (persistDir !== '') rmSync(persistDir, { recursive: true, force: true })
})

describe('AUTH-01 + NET-12 — a node with nothing obtains a certificate and spends it on TURN', () => {
  it('ARM 0: the object says it issues, which is what a publisher probes before offering', async () => {
    const reported = await self()
    const enrolment = reported['enrolment'] as Record<string, unknown> | undefined
    expect(enrolment?.['issues']).toBe(true)
    expect(enrolment?.['maxIssuedPerWindow']).toBe(BUDGET)
  })

  it('ARMS 1-4: enrol over libp2p, then mint TURN with what came back, then hit the throttle', async () => {
    // One case, four arms, because they are one claim: each arm is only meaningful given the
    // one before it. Splitting them across `it` blocks would let arm 3 run against a
    // certificate arm 1 never obtained, and vitest gives no ordering guarantee worth relying on.
    const reported = await self()
    const peerId = String(reported['peerId'])
    const issuer = String(reported['nodeKey'])
    const relayAddr = `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${peerId}`

    const client = await joiner()
    try {
      await client.node.dial(multiaddr(relayAddr), { signal: AbortSignal.timeout(30_000) })

      // ARM 1 — the thing that did not exist. A node holding nothing asks, over libp2p, and is
      // certified. Before this commit the answer here was `this node issues no certificates`.
      const first = await enrol(USER_SEED, peerId, client.rpc)
      expect(first.ok, `enrolment failed: ${first.reason}`).toBe(true)
      const certificate = first.certificate
      if (certificate === undefined) return

      // ARM 2 — the issuer is the hosted object itself, read off its own `/self`. This is what
      // makes arm 3 a statement about derivation rather than about a variable somebody set.
      expect(certificate.issuer).toBe(issuer)
      expect(certificate.nodeKey).toBe(toHex(ed25519.getPublicKey(NODE_SEED)))

      // ARM 3 — THE JOIN. The same object, over HTTP this time, is handed the certificate it
      // signed a moment ago and mints a TURN credential against it. No `O2_TRUSTED_ISSUERS` is
      // configured on this workerd: if the own-issuer union were not derived, this is `400
      // certificate-refused` and the whole chain the cohort needs is still broken.
      const granted = await askForTurn(certificate)
      expect(granted.status, `TURN refused: ${JSON.stringify(granted.body)}`).toBe(200)
      expect(granted.body['ok']).toBe(true)
      expect(granted.body['urls']).toEqual(STUB_URLS)

      // ARM 4 — THE THROTTLE, global. The budget was one and arm 1 spent it, so this is
      // refused — and it asks under a DIFFERENT user key, which a per-user limit would have
      // granted. This is the owner's instruction measured rather than configured.
      const second = await enrol(OTHER_USER_SEED, peerId, client.rpc)
      expect(second.ok, 'a second certificate was issued against a budget of one').toBe(false)
      expect(second.reason.length).toBeGreaterThan(0)
    } finally {
      await client.node.stop()
    }
  }, 120_000)
})
