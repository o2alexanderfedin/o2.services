import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { toHex } from '@o2/core'
import type { NodeCertificate, PublicKeyHex } from '@o2/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Test-only relative import — the route `packages/net/src/distributed.test.ts` sanctions, and
// `turn-credential.e2e.test.ts` beside this file takes for the same reason.
import { certificatePayload } from '../../core/src/enrollment.ts'
import { turnMintPayload } from './turn-credential.ts'

/**
 * NET-12 — the PROVIDER-backed scheme, joined up inside the real workerd runtime.
 *
 * ## What this measures that nothing else can
 *
 * `turn-credential.test.ts` exercises `cloudflareTurnMinter` with an injected `fetch`, and
 * `turn-minter-selection.test.ts` holds the precedence and the status mapping. Neither reaches
 * the **join**: environment variables to minter selection to region lookup to status code, all
 * of which live in the deployed class — *"the only part of this file that no local spec can
 * reach"*. That join is exactly where the configuration trap lived, and the trap is not
 * hypothetical: until 2026-09-09 a deployment holding only the API key pair declared no TURN
 * URLs anywhere, `turnUrlsFor` collapsed *declared with none* into *undeclared*, and **every
 * mint would have answered `unknown-region`** — a correctly configured deployment telling a
 * correctly configured tab that `bootstrap-us` is not a region.
 *
 * So this spec boots a workerd in the shape the fabric is about to deploy: **the key pair set,
 * and no `O2_TURN_URLS` of any kind.**
 *
 * ## It dials nobody
 *
 * `O2_TURN_API_BASE` points at a stub on loopback that answers the shape measured against
 * `rtc.live.cloudflare.com` on 2026-09-09. Reaching the real endpoint from a test lane would
 * put somebody else's uptime inside this suite's greenness and would violate the rule
 * `hermetic-fixtures.node.test.ts` was written to hold a week earlier. `CLOUDFLARE_API_TOKEN`
 * is blanked, metrics are off, and `--persist-to` is a fresh directory removed in teardown.
 * **No deploy, no remote resource, no credential of the owner's anywhere in this file.**
 */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'
/** Its own port — `turn-credential.e2e.test.ts` holds 8814 and the lane may run them together. */
const PORT = 8816
const STUB_PORT = 8817

/** Long enough for `assertUsablePassphrase`; see the sibling spec's note on the twenty-character floor. */
const SECRET = 'local-dev-identity-secret-provider-join'
const KEY_ID = 'a-key-id-that-is-not-a-secret'
const API_SECRET = 'an-api-credential-this-spec-invented'

const ISSUER_SEED = new Uint8Array(32).fill(31)
const NODE_SEED = new Uint8Array(32).fill(33)

/** The provider's own endpoints — deliberately nothing this deployment could have declared. */
const STUB_URLS = [
  'turn:a-provider-endpoint.invalid:3478?transport=udp',
  'turns:a-provider-endpoint.invalid:443?transport=tcp',
]
/** Opaque, 64 characters, as measured. Nothing here can put a region or a node key into it. */
const STUB_USERNAME = '0448a2f1e5c47d9b3a6e8f2c1d5b7a94e3f8c2d6b1a5e9f4c8d2b6a3e7f1c5d9'
const STUB_CREDENTIAL = '4d53c8f1a9e2b7d4c6f8a1e3b5d7c9f2a4e6b8d1c3f5a7e9b2d4c6f8a1e3b5d7'

let worker: ChildProcess | undefined
let stub: Server | undefined
let persistDir = ''

/** What the stub was last asked, so the request the worker built can be read back. */
interface StubCall {
  readonly path: string
  readonly authorization: string | undefined
  readonly body: string
}
let calls: StubCall[] = []
/** Flipped by an arm to make the provider refuse, so the 502 path is measured and not assumed. */
let stubStatus = 200

function keyOf(seed: Uint8Array): PublicKeyHex {
  return toHex(ed25519.getPublicKey(seed))
}

function certificateFor(nodeSeed: Uint8Array, issuerSeed: Uint8Array, now: number): NodeCertificate {
  const unsigned: Omit<NodeCertificate, 'signature'> = {
    nodeKey: keyOf(nodeSeed),
    userKey: keyOf(issuerSeed),
    operatorId: 'phase-39-provider-join',
    discoverability: 'seed',
    relayIds: [],
    issuedAt: now - 60_000,
    expiresAt: now + 3_600_000,
    issuer: keyOf(issuerSeed),
  }
  return { ...unsigned, signature: toHex(ed25519.sign(certificatePayload(unsigned), issuerSeed)) }
}

async function askForCredential(region = 'bootstrap-us'): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const nodeKey = keyOf(NODE_SEED)
  const requestedAt = Date.now()
  const signature = toHex(ed25519.sign(turnMintPayload(nodeKey, region, requestedAt), NODE_SEED))
  const response = await fetch(`http://${HOST}:${String(PORT)}/turn-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      certificate: certificateFor(NODE_SEED, ISSUER_SEED, Date.now()),
      nodeKey,
      region,
      requestedAt,
      signature,
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
  stub = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += String(chunk)))
    request.on('end', () => {
      calls.push({
        path: request.url ?? '',
        authorization: request.headers['authorization'],
        body,
      })
      if (stubStatus !== 200) {
        response.writeHead(stubStatus, { 'Content-Type': 'application/json' })
        response.end('{"error":"the provider said no"}')
        return
      }
      response.writeHead(201, { 'Content-Type': 'application/json' })
      // The measured shape: an ARRAY, first entry STUN with NO credentials at all. A worker that
      // took `iceServers[0]` would answer a tab with `undefined` in both fields.
      response.end(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:a-provider-endpoint.invalid:3478'] },
            { urls: STUB_URLS, username: STUB_USERNAME, credential: STUB_CREDENTIAL },
          ],
        }),
      )
    })
  })
  await new Promise<void>((resolve) => stub?.listen(STUB_PORT, HOST, resolve))

  persistDir = await mkdtemp(join(tmpdir(), 'o2-turn-provider-join-'))
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
      '--var',
      `O2_TRUSTED_ISSUERS:${keyOf(ISSUER_SEED)}`,
      // THE POINT OF THIS SPEC: the provider pair, and NOT ONE URL VAR.
      '--var',
      `O2_TURN_KEY_ID:${KEY_ID}`,
      '--var',
      `O2_TURN_API_SECRET:${API_SECRET}`,
      '--var',
      `O2_TURN_API_BASE:http://${HOST}:${String(STUB_PORT)}/v1/turn/keys`,
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
  if (persistDir !== '') await rm(persistDir, { recursive: true, force: true })
})

describe('NET-12 — a deployment that declares NO TURN URLs of its own still mints', () => {
  it('ARM 1 (the trap): the provider pair alone is a working deployment', async () => {
    calls = []
    const { status, body } = await askForCredential()

    // Before the `turnUrlsFor` split this was a 400 reading `unknown-region`. That is the whole
    // claim of this arm and it is why the workerd above is started with no URL var.
    expect(status, `expected a grant, got ${JSON.stringify(body)}`).toBe(200)
    expect(body['ok']).toBe(true)
    expect(body['kind']).toBeUndefined()
    expect(body['region']).toBe('bootstrap-us')
  })

  it('ARM 2: the credential handed to the tab is the PROVIDER’s, endpoints included', async () => {
    const { body } = await askForCredential()
    expect(body['username']).toBe(STUB_USERNAME)
    expect(body['credential']).toBe(STUB_CREDENTIAL)
    expect(body['urls']).toEqual(STUB_URLS)
    // The STUN entry carried no credentials; a worker taking the first entry would have shipped
    // `undefined` here and this is where that would surface.
    expect(JSON.stringify(body['urls'])).not.toContain('stun:')
    // And the username is opaque: it does NOT carry `expiry:region:nodeKey`. Attribution moved
    // to the provider on this path, which is consequence 2 of `turn-credential.ts`'s AMENDED
    // block, asserted here rather than only described there.
    expect(String(body['username'])).not.toContain(keyOf(NODE_SEED))
    expect(String(body['username']).split(':')).toHaveLength(1)
  })

  it('ARM 3: the worker presents the API credential as a Bearer and asks for the gate’s lifetime', async () => {
    calls = []
    await askForCredential()
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.path).toBe(`/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`)
    expect(call?.authorization).toBe(`Bearer ${API_SECRET}`)
    // 600 as a literal, not read back from `CREDENTIAL_LIFETIME_MS`. The probe that established
    // the model asked for 3600; a worker quietly asking for the probe's hour would extend every
    // credential six-fold with nothing in the code saying so.
    expect(call?.body).toBe('{"ttl":600}')
  })

  it('ARM 4: an undeclared region is STILL refused, so arm 1 is not an open gate', async () => {
    // The control for arm 1. Without it, "no URLs declared and it minted" is equally consistent
    // with a region check that stopped running at all.
    calls = []
    const { status, body } = await askForCredential('bootstrap-atlantis')
    expect(status).toBe(400)
    expect(body['kind']).toBe('unknown-region')
    // And it refused BEFORE spending a request on the provider.
    expect(calls).toHaveLength(0)
  })

  it('ARM 5: a provider that refuses answers 502, never 400 — the caller did nothing wrong', async () => {
    stubStatus = 401
    try {
      const { status, body } = await askForCredential()
      // 502 rather than 400: this caller presented a certificate and a signature that both
      // verified. A 400 would send a tab looking for a bug it does not have, and the operator —
      // whose API credential is the actual fault — would never learn of it.
      expect(status).toBe(502)
      expect(body['kind']).toBe('provider-refused')
      expect(String(body['reason'])).toContain('401')
      expect(body['credential']).toBeUndefined()
    } finally {
      stubStatus = 200
    }
  })
})
