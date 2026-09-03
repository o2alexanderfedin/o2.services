import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { toHex } from '@o2/core'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureViteCacheDir, launchFixtureBrowser, startCoturn } from './e2e-browser-launch.ts'
import type { CoturnHarness } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-12 — the seams joined: a tab fetches its credential from the gated minter and the pair
 * connects with **that** credential.
 *
 * ## Why this file exists at all
 *
 * `turn-credential.e2e.test.ts` proves the gate admits and refuses. `turn-fallback.e2e.test.ts`
 * proves a pair connects over real TURN. **Two halves each proved and joined by nobody is the
 * same defect this repository has been caught by three times** — the DHT that was wired and
 * unused, `workerd-shims` imported by nothing, `hosted-capabilities` producing records nothing
 * published. A module that is *"correct and unreached is indistinguishable from one that is
 * absent"*, and so is a pair of modules that never meet.
 *
 * So: one arrangement, five servers — a Vite dev server for the demo, a `FabricNode` that is
 * both the circuit relay for SDP **and** the enrolment provider, a local `coturn`, and **two**
 * local workerds. No credential is written into the test's ICE configuration by hand. If the
 * fetch does not happen, nothing connects.
 *
 * ## Why two workerds
 *
 * The two arms must differ in **exactly one** thing: whether the minter pins the issuer that
 * signed the tab's certificate. Same tab code, same real certificate from the same provider,
 * same coturn, same secret — one minter pins `provider.issuerKey` and the other pins a stranger.
 * A single worker could not express that, and swapping the tab's certificate instead would have
 * changed two variables at once.
 *
 * ## The joint is a shared secret, and that is what the second plant attacks
 *
 * coturn and both workers hold **one** value. A worker minting under one secret and a coturn
 * checking under another produces a `401` that reads exactly like a network fault — which is why
 * the plant that gives them different secrets is worth more than any assertion here.
 *
 * ## What this arrangement is NOT
 *
 * Five servers on one machine is a **joint test, not a deployment test**. Nothing here has been
 * observed against a deployed Durable Object or against a real provider's TURN service; the
 * credential scheme exercised is `coturn`'s shared-secret mode, and Cloudflare's own scheme is
 * deliberately unwritten (CORRECTION 4). Task 6's runbook is where that is owed, and its first
 * step is a spending alert rather than an engineering one.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const ADMITTING_PORT = 8815
const REFUSING_PORT = 8816

/** A stranger nobody enrolled with. The refusing worker pins this and only this. */
const STRANGER_ISSUER = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(99)))

/**
 * An anchor this file never uses, because nothing here runs an artifact.
 *
 * Present so the relay can be started without reaching for the provenance opt-out — see the
 * comment at its call site.
 */
const UNUSED_TRUST_ANCHOR = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(62)))

let relay: FabricNode
let relayAddr: string
let issuerKey: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
let coturn: CoturnHarness
const workers: ChildProcess[] = []
const persistDirs: string[] = []
const contexts: BrowserContext[] = []

/** The visitor's owner key. A tab enrols under it, exactly as `browser-enrollment` does. */
const visitorKey = new Uint8Array(32).fill(41)

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/self`, {
        signal: AbortSignal.timeout(3000),
      })
      if (response.ok) return
      lastError = new Error(`/self answered ${String(response.status)}`)
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd on ${String(port)} not ready in ${String(timeoutMs)} ms: ${String(lastError)}`)
}

/** Spawn a local workerd pinning `pinned`, sharing coturn's secret. Local only; no deploy. */
async function startWorker(port: number, pinned: string): Promise<void> {
  const persistDir = await mkdtemp(join(tmpdir(), `o2-turn-e2e-${String(port)}-`))
  persistDirs.push(persistDir)
  workers.push(
    spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(port),
        '--local-protocol',
        'http',
        '--persist-to',
        persistDir,
        '--var',
        `O2_TURN_SECRET:${coturn.secret}`,
        '--var',
        `O2_TRUSTED_ISSUERS:${pinned}`,
        '--var',
        `O2_TURN_URLS:${coturn.urls.join(',')}`,
      ],
      {
        cwd: CLOUDFLARE_DIR,
        env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
        stdio: 'ignore',
      },
    ),
  )
  await waitForReady(port, 120_000)
}

interface Tab {
  readonly page: Page
  readonly peerId: string
}

/** An ENROLLED tab, pointed at one of the two minters. */
async function openEnrolledTab(name: string, minterPort: number): Promise<Tab> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', (error) => process.stderr.write(`[${name}] page error: ${error.message}\n`))

  const query = new URLSearchParams({
    turn: `http://127.0.0.1:${String(minterPort)}/turn-credential`,
    iceTransportPolicy: 'relay',
  })
  await page.goto(`${baseUrl}${PAGE}?${query.toString()}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })

  const peerId = await page.evaluate(
    async ([address, store, userKey, operatorId]) => {
      window.o2.grantConsent()
      return window.o2.start({
        relayAddrs: [address as string],
        blockstoreName: store as string,
        // AUTH-01 — a real enrolment against the provider, so this tab holds a real
        // certificate signed by a real issuer. Nothing here is a fixture.
        enrollment: {
          userPrivateKey: userKey as number[],
          operatorId: operatorId as string,
          providerAddr: address as string,
        },
      })
    },
    [relayAddr, `o2-e2e-${name}`, Array.from(visitorKey), `phase-34-${name}`] as [
      string,
      string,
      number[],
      string,
    ],
  )
  return { page, peerId }
}

/** Dial `to` from `from` and report whether an UNLIMITED /webrtc connection formed. */
async function pairFormed(from: Tab, to: Tab, timeoutMs: number): Promise<boolean> {
  let address: string
  try {
    const addrs = await to.page.evaluate(
      async (ms) => window.o2.waitForWebrtcAddr(ms),
      Math.min(timeoutMs, 30_000),
    )
    const first = addrs[0]
    if (first === undefined) return false
    address = first
  } catch {
    return false
  }
  try {
    await from.page.evaluate(
      async ([target, ms]) =>
        Promise.race([
          window.o2.dial(target as string),
          new Promise((_, reject) => setTimeout(() => reject(new Error('deadline')), ms as number)),
        ]),
      [address, timeoutMs] as [string, number],
    )
  } catch {
    // Arm 2 expects this.
  }
  return from.page.evaluate(
    async (peerId) =>
      window.o2.connectionsTo(peerId).some((c) => c.remoteAddr.includes('/webrtc') && !c.limited),
    to.peerId,
  )
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-turn-e2e-'))
  coturn = await startCoturn()

  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // A real anchor rather than `'runs-unsigned-artifacts'`, and the difference is not
    // cosmetic. This relay relays and issues; **nothing in this file runs an artifact at
    // all** — no `runJob`, no `putModule` — so the provenance opt-out would be claiming an
    // exemption this spec has no use for. `trust-anchors.node.test.ts` bounds how far that
    // opt-out spreads through the suite precisely so it is not reached for by reflex.
    trustAnchors: [UNUSED_TRUST_ANCHOR],
    // What gives it a signing key at all, so `issuerKey` below is real rather than invented.
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  const issuer = relay.issuerKey
  if (issuer === null) throw new Error('provider was started to issue and holds no key')
  issuerKey = issuer
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  // The one variable between the arms: which issuer each minter pins.
  await startWorker(ADMITTING_PORT, issuerKey)
  await startWorker(REFUSING_PORT, STRANGER_ISSUER)

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
}, 400_000)

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  coturn?.stop()
  for (const worker of workers) worker.kill('SIGTERM')
  for (const dir of persistDirs) await rm(dir, { recursive: true, force: true })
  await rm(workdir, { recursive: true, force: true })
}, 150_000)

describe('NET-12 — the tab, the gated minter, TURN and the pair, in one arrangement', () => {
  it('ARM 1 (admitted): an enrolled tab fetches a credential and the pair connects with it', async () => {
    const a = await openEnrolledTab('a', ADMITTING_PORT)
    const b = await openEnrolledTab('b', ADMITTING_PORT)

    const formed = await pairFormed(a, b, 90_000)

    expect(
      formed,
      `the pair formed no unlimited /webrtc connection. coturn log:\n${coturn.log().slice(-1500)}`,
    ).toBe(true)

    // **The joint, asserted at coturn.** The username carries the node key the tab's certificate
    // names, so the credential in use is demonstrably the one the GATE minted and not one this
    // harness left lying around. A bare "an allocation happened" would not show that.
    const allocations = coturn.allocations()
    expect(allocations.length, `coturn logged no allocation:\n${coturn.log()}`).toBeGreaterThan(0)
    const nodeKeys = new Set(allocations.map((username) => username.split(':')[2] ?? ''))
    expect(nodeKeys.size, 'the two tabs did not present two distinct node keys').toBeGreaterThan(1)
    // Minted by the hosted gate: the region tag is the middle field, and the gate is the only
    // thing in this arrangement that puts it there.
    expect(allocations.every((username) => username.split(':')[1] === 'bootstrap-us')).toBe(true)
  }, 300_000)

  it('ARM 2 (refused): a tab whose issuer the minter does not pin is refused and does not connect', async () => {
    const before = coturn.allocations().length
    const a = await openEnrolledTab('c', REFUSING_PORT)
    const b = await openEnrolledTab('d', REFUSING_PORT)

    const formed = await pairFormed(a, b, 45_000)

    expect(formed, 'a tab the minter refused still formed a TURN-carried pair').toBe(false)

    // **The absence, made non-vacuous.** An empty allocation log is exactly the reading a
    // completely broken arrangement produces. Arm 1 above allocated in this same file, against
    // this same coturn — that is the positive control which makes this absence mean something.
    // This repository has already had a phase criterion nearly close on an empty read whose
    // control was equally empty.
    expect(
      before,
      'arm 1 logged no allocation either, so this absence is not evidence about the gate — ' +
        'it is evidence the arrangement did not start',
    ).toBeGreaterThan(0)
    expect(coturn.allocations().length, 'the refused tabs still obtained an allocation').toBe(before)

    // The refusal reached the tab as a NAMED reason rather than as a hang.
    const refusal = await a.page.evaluate(async () => {
      const response = await fetch(`http://127.0.0.1:8816/turn-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: 'bootstrap-us', requestedAt: Date.now() }),
      })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    })
    expect(refusal.status).toBe(400)
    expect(String(refusal.body['kind']).length).toBeGreaterThan(0)
  }, 200_000)
})
