import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { toHex } from '@o2/core'
import type { NodeCertificate, PublicKeyHex } from '@o2/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Test-only relative import — the route `packages/net/src/distributed.test.ts` sanctions.
// `certificatePayload` is deliberately absent from `@o2/core`'s barrel, and a spec that has to
// MINT a certificate the gate will accept is on the signing side of that line.
import { certificatePayload } from '../../core/src/enrollment.ts'
import { turnMintPayload } from './turn-credential.ts'

/**
 * NET-12 — the gate, running inside the real workerd runtime.
 *
 * The node-lane spec beside this one exercises the same gate as a pure function. This one exists
 * because the gate has to survive being a **route**: a body that crossed JSON, a `Date.now()`
 * that is the worker's rather than the test's, configuration that arrived as `--var`, and CORS.
 * Every one of those has broken a correct module in this repository before.
 *
 * ## Scope fence, and every clause of it is load-bearing
 *
 * Local `workerd` only, through `wrangler dev`. `CLOUDFLARE_API_TOKEN` is blanked so a path
 * reaching for Cloudflare fails here rather than touching the owner's account, metrics are off,
 * and `--persist-to` points at a fresh `mkdtemp` directory that is removed in teardown. That
 * last one is **not** inherited from `hosted-record-store.e2e.test.ts`, which does not pass it;
 * `stop-closes-the-billed-socket.e2e.test.ts` already followed the same correction. **No
 * deploy, no TURN key, no remote resource.**
 *
 * The secret and issuer set arrive as `--var`. Measured 2026-08-27 and recorded in
 * `wrangler.jsonc`: `--var` **merges** with the file's `vars` rather than replacing them, so
 * `ANNOUNCE_MULTIADDRS` survives this injection.
 */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'
const PORT = 8814

const ISSUER_SEED = new Uint8Array(32).fill(21)
const OUTSIDER_SEED = new Uint8Array(32).fill(22)
const NODE_SEED = new Uint8Array(32).fill(23)

/** Generated per run and never written to a tracked file. */
const TURN_SECRET = 'e2e-secret-' + toHex(ed25519.getPublicKey(new Uint8Array(32).fill(24))).slice(0, 16)
const TURN_URLS = 'turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:53?transport=udp'

let worker: ChildProcess | undefined
let persistDir = ''

function keyOf(seed: Uint8Array): PublicKeyHex {
  return toHex(ed25519.getPublicKey(seed))
}

function certificateFor(nodeSeed: Uint8Array, issuerSeed: Uint8Array, now: number): NodeCertificate {
  const unsigned: Omit<NodeCertificate, 'signature'> = {
    nodeKey: keyOf(nodeSeed),
    userKey: keyOf(issuerSeed),
    operatorId: 'phase-34-e2e',
    discoverability: 'seed',
    relayIds: [],
    issuedAt: now - 60_000,
    expiresAt: now + 3_600_000,
    issuer: keyOf(issuerSeed),
  }
  return { ...unsigned, signature: toHex(ed25519.sign(certificatePayload(unsigned), issuerSeed)) }
}

/** Ask the deployed route for a credential, exactly as a tab would. */
async function askForCredential(fields: {
  readonly certificate: NodeCertificate
  readonly signerSeed: Uint8Array
  readonly region?: string
  readonly tamper?: boolean
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const nodeKey = keyOf(fields.signerSeed)
  const region = fields.region ?? 'bootstrap-us'
  const requestedAt = Date.now()
  const signature = toHex(
    ed25519.sign(turnMintPayload(nodeKey, region, requestedAt), fields.signerSeed),
  )
  const response = await fetch(`http://${HOST}:${String(PORT)}/turn-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      certificate: fields.certificate,
      nodeKey,
      region,
      requestedAt,
      signature: fields.tamper === true ? toHex(new Uint8Array(64)) : signature,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
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

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-turn-credential-'))
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      '--persist-to',
      persistDir,
      '--var',
      `O2_TURN_SECRET:${TURN_SECRET}`,
      '--var',
      `O2_TRUSTED_ISSUERS:${keyOf(ISSUER_SEED)}`,
      '--var',
      `O2_TURN_URLS:${TURN_URLS}`,
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
  if (persistDir !== '') await rm(persistDir, { recursive: true, force: true })
})

describe('NET-12 — the hosted tier admits the fabric and refuses everyone else', () => {
  it('ARM 1 (the floor): a certificate from the pinned issuer gets a credential', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED, Date.now())
    const { status, body } = await askForCredential({ certificate, signerSeed: NODE_SEED })

    expect(status, `expected a grant, got ${JSON.stringify(body)}`).toBe(200)
    expect(body['ok']).toBe(true)
    // The username carries the node key the certificate names, so an allocation logged by a
    // TURN server is attributable to this identity and not merely to "someone".
    expect(String(body['username'])).toContain(keyOf(NODE_SEED))
    expect(String(body['credential']).length).toBeGreaterThan(0)
    expect(body['region']).toBe('bootstrap-us')
    expect(Number(body['expiresAt'])).toBeGreaterThan(Date.now())
  })

  it('ARM 2: a certificate from an issuer outside the pinned set is refused BY NAME', async () => {
    const outsider = certificateFor(NODE_SEED, OUTSIDER_SEED, Date.now())
    const { status, body } = await askForCredential({ certificate: outsider, signerSeed: NODE_SEED })

    expect(
      JSON.stringify(body),
      'an outsider was served a TURN credential by the deployed route',
    ).not.toContain('"credential"')
    expect(status).toBe(400)
    expect(body['kind']).toBe('certificate-refused')
  })

  it('ARM 3: a request carrying no certificate at all is refused', async () => {
    const response = await fetch(`http://${HOST}:${String(PORT)}/turn-credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region: 'bootstrap-us', requestedAt: Date.now() }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(body['kind']).toBe('malformed-request')
  })

  it('ARM 4: a tampered signature is refused, even with a genuine certificate', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED, Date.now())
    const { status, body } = await askForCredential({
      certificate,
      signerSeed: NODE_SEED,
      tamper: true,
    })

    expect(JSON.stringify(body)).not.toContain('"credential"')
    expect(status).toBe(400)
    expect(body['kind']).toBe('bad-signature')
  })

  it('answers preflight, the leg that must work before the gate is ever reached', async () => {
    const response = await fetch(`http://${HOST}:${String(PORT)}/turn-credential`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(10_000),
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('leaves GET /self answering exactly as it did', async () => {
    const response = await fetch(`http://${HOST}:${String(PORT)}/self`, {
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(typeof body['peerId']).toBe('string')
    expect(typeof body['nodeKey']).toBe('string')
  })
})
