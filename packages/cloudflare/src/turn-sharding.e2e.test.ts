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
import { certificatePayload } from '../../core/src/enrollment.ts'
import { turnMintPayload } from './turn-credential.ts'

/**
 * NET-12 — three declared regions mint three tagged rungs, and an undeclared one is refused.
 *
 * ## READ THIS BEFORE READING THE ASSERTIONS: what this file is not
 *
 * Three region names answered by **one local workerd** is one object serving three names. It is
 * not three objects, and it is emphatically not three regions. Nothing here is evidence about
 * where anything runs, and this file does **not** close criterion 2.
 *
 * ## Criterion 2 needs TWO things this milestone does not have
 *
 * 1. **Three sited objects** — Phase 33's subject, gated on the owner and on money, not run.
 * 2. **Clients on two continents** — without them there is no cross-continent *pair* to observe,
 *    even if the three objects existed. Phase 39's cohort, or the tester cohort the owner
 *    already has access to.
 *
 * *Descoped is not satisfied; unmeasured is not met.* A same-region substitute does not count and
 * `NET-12` stays unchecked.
 *
 * ## DEVIATION, recorded here because it is a refusal to follow the plan
 *
 * The plan asked for the mint request to be **routed to the named region's Durable Object**
 * through `stubFor`. That was not done, and the reason is this repository's own recorded ruling
 * at `worker.ts`'s `SERVED_BY`:
 *
 * > *"A constant, never derived from the request. Criterion 6's subject is precisely that a
 * > visitor cannot cause an object to be created, and an object is created by its first `get()`.
 * > A `?region=` parameter here would be the defect, and it would be invisible: the request
 * > would succeed, the object would exist, and its siting would be permanent."*
 *
 * Routing a visitor-supplied region name into `stubFor` is exactly that parameter. It would let
 * any caller create and permanently site two Durable Objects the owner has not decided to
 * create — money spent and a siting fixed, by a stranger, invisibly. Phase 29 criterion 6
 * forbids it and Phase 33 owns the decision.
 *
 * So the sharding that landed is the half that does not require it: **the region rides in the
 * credential**. The minted username's middle field is the region tag, so an allocation logged by
 * a TURN server is attributable to the region that minted it, whichever object served the
 * request. What is deferred with Phase 33 is *which object answers*, which is a siting question
 * rather than an attribution one.
 */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1'
const PORT = 8817

const ISSUER_SEED = new Uint8Array(32).fill(31)
const NODE_SEED = new Uint8Array(32).fill(32)
const TURN_SECRET = 'sharding-e2e-secret-not-a-real-one'

/** Per-region endpoints, deliberately distinct so a wrong tag cannot hide behind a shared list. */
const US_URLS = 'turn:us.example.invalid:3478?transport=udp'
const EU_URLS = 'turn:eu.example.invalid:3478?transport=udp'
const SAM_URLS = 'turn:sam.example.invalid:3478?transport=udp'

let worker: ChildProcess | undefined
let persistDir = ''

function keyOf(seed: Uint8Array): PublicKeyHex {
  return toHex(ed25519.getPublicKey(seed))
}

function certificateFor(nodeSeed: Uint8Array, issuerSeed: Uint8Array): NodeCertificate {
  const now = Date.now()
  const unsigned: Omit<NodeCertificate, 'signature'> = {
    nodeKey: keyOf(nodeSeed),
    userKey: keyOf(issuerSeed),
    operatorId: 'phase-34-sharding',
    discoverability: 'seed',
    relayIds: [],
    issuedAt: now - 60_000,
    expiresAt: now + 3_600_000,
    issuer: keyOf(issuerSeed),
  }
  return { ...unsigned, signature: toHex(ed25519.sign(certificatePayload(unsigned), issuerSeed)) }
}

async function mint(region: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const nodeKey = keyOf(NODE_SEED)
  const requestedAt = Date.now()
  const response = await fetch(`http://${HOST}:${String(PORT)}/turn-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      certificate: certificateFor(NODE_SEED, ISSUER_SEED),
      nodeKey,
      region,
      requestedAt,
      signature: toHex(ed25519.sign(turnMintPayload(nodeKey, region, requestedAt), NODE_SEED)),
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
  throw new Error(`workerd not ready in ${String(timeoutMs)} ms: ${String(lastError)}`)
}

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-turn-sharding-'))
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
      `O2_TURN_URLS_US:${US_URLS}`,
      '--var',
      `O2_TURN_URLS_EU:${EU_URLS}`,
      '--var',
      `O2_TURN_URLS_SAM:${SAM_URLS}`,
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

describe('NET-12 — each declared region mints its own rung, tagged', () => {
  const expected = [
    ['bootstrap-us', US_URLS],
    ['bootstrap-eu', EU_URLS],
    ['bootstrap-sam', SAM_URLS],
  ] as const

  for (const [region, urls] of expected) {
    it(`${region} returns its own tag and its own endpoints`, async () => {
      const { status, body } = await mint(region)

      expect(status, `expected a grant for ${region}, got ${JSON.stringify(body)}`).toBe(200)
      expect(body['region']).toBe(region)
      expect(body['urls']).toEqual([urls])
      // The region rides IN the credential: the username's middle field. That is what makes an
      // allocation attributable to the region that minted it, whichever object served it.
      expect(String(body['username']).split(':')[1]).toBe(region)
    })
  }

  it('gives the three regions three DIFFERENT tags — one object answering three names is not one region', async () => {
    const tags = await Promise.all(
      expected.map(async ([region]) => String((await mint(region)).body['username']).split(':')[1]),
    )
    expect(new Set(tags).size, `the three regions minted ${JSON.stringify(tags)}`).toBe(3)
  })

  it('refuses a region outside the closed set, by name', async () => {
    const { status, body } = await mint('bootstrap-atlantis')

    expect(JSON.stringify(body)).not.toContain('"credential"')
    expect(status).toBe(400)
    expect(body['kind']).toBe('unknown-region')
  })
})
