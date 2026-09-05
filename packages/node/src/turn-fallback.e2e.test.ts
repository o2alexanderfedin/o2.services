import { createServer as createHttpServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { toHex } from '@o2/core'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Test-only relative import — the route `packages/net/src/distributed.test.ts` sanctions.
// `packages/node` does NOT declare `@o2/cloudflare` as a workspace dependency, and this phase
// does not add one for a test. The minter reached here is the SAME module the hosted tier runs,
// which is the point: a harness with its own copy would prove coturn accepts the harness.
import { sharedSecretMinter } from '../../cloudflare/src/turn-credential.ts'
import { fixtureViteCacheDir, launchFixtureBrowser, startCoturn } from './e2e-browser-launch.ts'
import type { CoturnHarness } from './e2e-browser-launch.ts'
import { signInHarnessTab } from './e2e-signin.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-12, criterion 1 — a pair that cannot use a direct candidate connects over real TURN.
 *
 * ## What `iceTransportPolicy: 'relay'` is, and what it is NOT
 *
 * It makes a direct candidate **impossible by policy**. That is a deliberate substitution for a
 * condition this harness cannot build: a symmetric NAT is not constructible between two browser
 * contexts on one loopback machine, so the only honest way to remove the direct path is to
 * forbid it.
 *
 * So what is proved here is *the rung carries a pair when no direct candidate is usable*. What
 * is **not** proved is *how often real networks make direct candidates unusable* — that is
 * cohort evidence and it belongs to the public run. The 10–20 % relay-required figure quoted
 * elsewhere is a **PROXY** from a different protocol and `RUN-05` criterion 5 forbids presenting
 * it as measured. Do not let the first claim be reported as the second.
 *
 * ## The arms, and why arm B exists
 *
 * - **A — the criterion.** Two isolated contexts, both relay-only with a valid credential,
 *   connect and do real work. Two readings from OUTSIDE the page: the configuration the page
 *   actually handed `RTCPeerConnection`, and coturn's own log showing an allocation per tab.
 * - **B — the floor.** The identical arrangement with no reachable TURN server does NOT
 *   connect. Without it, arm A cannot tell *connected over TURN* from *connected somehow*, and
 *   is an instrument that measures nothing.
 * - **C — expiry, time advanced.** A credential minted already-expired produces no allocation.
 * - **D — expiry, waited out.** A short-lived credential works, then stops after its lifetime
 *   passes with a fresh gathering forced. The control that C exercised a clock and not a branch.
 *
 * **Arm D does NOT carry the credential-ROTATION claim, and that was measured rather than
 * assumed.** A plant that made the holder's cache never refetch left arm D **green**: its second
 * half opens fresh contexts whose holders start empty, so they fetch once and there is no cached
 * credential for a broken cache to wrongly re-use. What arm D therefore proves is *the server
 * refuses an expired credential on a fresh gathering* — criterion 1's expiry clause — and not
 * *the tab replaces its credential before it dies*. The case that carries rotation is
 * `turn-credentials.test.ts`'s *"refetches once the clock is inside the refresh margin"*, which
 * that same plant reddens (`expected 1 to be 2`). Both claims are held; they are just held in
 * different places, and saying so here is cheaper than the next reader re-deriving it.
 * - **Open-relay hardening.** An unauthenticated Allocate answers 401 — the same reading the
 *   provider probe took against Cloudflare, taken here against the server this spec trusts.
 *
 * **C and D are observationally identical at the error level and that is recorded rather than
 * glossed:** coturn answers `401 Unauthorized` / `Cannot find credentials of user <…>` for an
 * expired credential and for a wrong-secret one alike. What makes C a statement about *expiry*
 * is that the same minter, with a future expiry, is observed working in the same run — arm A.
 * A comparison inside one run, which is what this repository prefers to an absolute.
 *
 * ## The recorder
 *
 * `page.addInitScript` wraps `RTCPeerConnection` before any page script evaluates, which is the
 * **only** placement that works: `@libp2p/webrtc`'s browser build does
 * `export const RTCPeerConnection = globalThis.RTCPeerConnection` at module evaluation, so a
 * wrapper installed later is invisible to it permanently. Phase 37 measured that
 * (`ice-observer-install.ts`), and it composes with this one — that wrapper wraps this one, and
 * constructor arguments pass through both `super(...)` calls untouched. The first case below
 * verifies the recorder actually captured something rather than assuming it did.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** Arm D's credential lifetime. Long enough to be a real passage of time, short enough to be cheap. */
const SHORT_LIFETIME_MS = 8_000

/**
 * An anchor this file never uses, because nothing here runs an artifact.
 *
 * Present so the relay can be started without reaching for the provenance opt-out — see the
 * comment at its call site.
 */
const UNUSED_TRUST_ANCHOR = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(61)))

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
let coturn: CoturnHarness
let stub: Server
let stubPort = 0
const contexts: BrowserContext[] = []

/**
 * Arm-selectable minting, served over HTTP so the tab's real code path is exercised.
 *
 * The tab fetches from `?turn=` exactly as it will in production; what changes per arm is what
 * this stub answers. Task 4 replaces it with the gated workerd and keeps the tab unchanged,
 * which is what makes a failure in one diagnosable rather than a failure of both.
 */
let mintMode: 'valid' | 'already-expired' | 'short-lived' = 'valid'

/** Node keys the stub has minted for, so an allocation can be attributed to a TAB. */
let mintedNodeKeys = new Set<string>()

async function mintFor(nodeKey: string): Promise<Record<string, unknown>> {
  mintedNodeKeys.add(nodeKey)
  const lifetimeMs =
    mintMode === 'already-expired' ? -120_000 : mintMode === 'short-lived' ? SHORT_LIFETIME_MS : 600_000
  const grant = await sharedSecretMinter(coturn.secret).mint({
    nodeKey,
    region: 'bootstrap-us',
    expiresAt: Date.now() + lifetimeMs,
    urls: coturn.urls,
  })
  return { ok: true, ...grant }
}

/** An unauthenticated TURN Allocate, for the open-relay reading. */
async function unauthenticatedAllocate(port: number): Promise<{ type: string; errorCode: number | null }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    const request = Buffer.alloc(20)
    request.writeUInt16BE(0x0003, 0) // ALLOCATE
    request.writeUInt16BE(0, 2)
    request.writeUInt32BE(0x2112a442, 4)
    randomBytes(12).copy(request, 8)
    const timer = setTimeout(() => {
      socket.close()
      resolve({ type: 'no reply', errorCode: null })
    }, 3000)
    socket.on('message', (message) => {
      clearTimeout(timer)
      let offset = 20
      let code: number | null = null
      while (offset + 4 <= message.length) {
        const attribute = message.readUInt16BE(offset)
        const length = message.readUInt16BE(offset + 2)
        if (attribute === 0x0009 && offset + 4 + length <= message.length) {
          code = (message[offset + 6] ?? 0) * 100 + (message[offset + 7] ?? 0)
        }
        offset += 4 + length + ((4 - (length % 4)) % 4)
      }
      socket.close()
      resolve({ type: `0x${message.readUInt16BE(0).toString(16).padStart(4, '0')}`, errorCode: code })
    })
    socket.send(request, port, '127.0.0.1')
  })
}

/**
 * What a dial attempt produced.
 *
 * Two fields because `held` and `webrtc` genuinely differ: two tabs on one relay hold each other
 * over a circuit whether or not any WebRTC path formed.
 */
interface PairOutcome {
  readonly held: boolean
  readonly webrtc: boolean
}

interface Tab {
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

/**
 * Open an isolated context with the recorder installed and a node started.
 *
 * `turnEndpoint` is `null` for arm B, which points the page at nothing and is the shape a real
 * outage takes.
 */
async function openTab(
  name: string,
  options: { readonly turnEndpoint: string | null; readonly refreshMarginMs?: number },
): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()

  // BEFORE any page script. See this file's header for why nothing later can work.
  await page.addInitScript(() => {
    const seen: unknown[] = []
    const live: RTCPeerConnection[] = []
    ;(globalThis as unknown as Record<string, unknown>)['__o2IceConfigs'] = seen
    ;(globalThis as unknown as Record<string, unknown>)['__o2IcePeers'] = live
    const Original = globalThis.RTCPeerConnection
    class Recording extends Original {
      constructor(...args: [RTCConfiguration?]) {
        // Recorded BEFORE `super`, so a construction that throws is still observed.
        seen.push(JSON.parse(JSON.stringify(args[0] ?? {})))
        super(...args)
        // Kept so `getStats()` can be walked from outside the page for the SELECTED candidate
        // pair — the reading criterion 1's sentence is actually about.
        live.push(this as unknown as RTCPeerConnection)
      }
    }
    globalThis.RTCPeerConnection = Recording as unknown as typeof RTCPeerConnection
  })

  page.on('pageerror', (error) => process.stderr.write(`[${name}] page error: ${error.message}\n`))

  const query = new URLSearchParams({ iceTransportPolicy: 'relay' })
  if (options.turnEndpoint !== null) query.set('turn', options.turnEndpoint)
  if (options.refreshMarginMs !== undefined) {
    query.set('turnRefreshMargin', String(options.refreshMarginMs))
  }
  await page.goto(`${baseUrl}${PAGE}?${query.toString()}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })

  // BROW-01 / AUTH-06: a harness consents and signs in for the same reasons a visitor
  // presses the two controls — see `signInHarnessTab`.
  await signInHarnessTab(page)
  const peerId = await page.evaluate(
    async ([address, store]) => window.o2.start({ relayAddrs: [address!], blockstoreName: store! }),
    [relayAddr, `o2-turn-${name}`],
  )

  const tab: Tab = { context, page, peerId }
  contexts.push(context)
  return tab
}

/** What the page actually handed `RTCPeerConnection`, read from outside the page. */
async function recordedConfigs(page: Page): Promise<RTCConfiguration[]> {
  return page.evaluate(
    () => (globalThis as unknown as { __o2IceConfigs: RTCConfiguration[] })['__o2IceConfigs'],
  )
}

/**
 * The candidate types of every SELECTED candidate pair this page holds.
 *
 * Criterion 1's sentence is about *the selected candidate pair's local candidate being
 * `typ relay`*, which is a fact only `getStats()` holds. A configuration carrying a TURN entry
 * says what was OFFERED; this says what was USED. They are different claims and only the second
 * is the criterion's.
 */
async function selectedLocalCandidateTypes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const peers =
      (globalThis as unknown as { __o2IcePeers?: RTCPeerConnection[] })['__o2IcePeers'] ?? []
    const types: string[] = []
    for (const peer of peers) {
      let report: RTCStatsReport
      try {
        report = await peer.getStats()
      } catch {
        continue
      }
      const byId = new Map<string, Record<string, unknown>>()
      report.forEach((entry) => {
        byId.set(String((entry as { id: string }).id), entry as unknown as Record<string, unknown>)
      })
      for (const entry of byId.values()) {
        if (entry['type'] !== 'candidate-pair') continue
        if (entry['state'] !== 'succeeded' || entry['nominated'] !== true) continue
        const local = byId.get(String(entry['localCandidateId']))
        if (local !== undefined) types.push(String(local['candidateType']))
      }
    }
    return types
  })
}

/**
 * Try to dial `to` from `from`, answering whether the pair actually formed.
 *
 * The `two-tabs.e2e.test.ts` shape: the target publishes a `/webrtc` address through its relay
 * reservation, the dialler dials it, and the reading that counts is `peers()` containing the
 * target — a dial that resolves without a peer is not a pair.
 *
 * Every failure answers `false` rather than throwing, because arms B, C and D **expect** not to
 * connect and a throw there would be indistinguishable from a broken harness.
 */
async function dials(from: Tab, to: Tab, timeoutMs: number): Promise<PairOutcome> {
  let address: string
  try {
    const addrs = await to.page.evaluate(
      async (ms) => window.o2.waitForWebrtcAddr(ms),
      Math.min(timeoutMs, 30_000),
    )
    const first = addrs[0]
    if (first === undefined) return { held: false, webrtc: false }
    address = first
  } catch {
    return { held: false, webrtc: false }
  }
  try {
    await from.page.evaluate(
      async ([target, ms]) =>
        Promise.race([
          window.o2.dial(target as string),
          new Promise((_, reject) => setTimeout(() => reject(new Error('dial deadline')), ms as number)),
        ]),
      [address, timeoutMs] as [string, number],
    )
  } catch {
    // Arms B, C and D EXPECT this. A throw here would be indistinguishable from a broken
    // harness, so the failure is carried as a value.
  }
  return from.page.evaluate(async (peerId) => {
    const connections = window.o2.connectionsTo(peerId)
    return {
      held: window.o2.peers().includes(peerId),
      // **The transport, not merely the peer.** libp2p marks a relayed circuit `limited`
      // (2 min / 64 KiB each way); a WebRTC connection — TURN'd or direct — is unlimited. Two
      // tabs hold each other over the circuit as a matter of course, so `peers()` alone answers
      // true even when no WebRTC path exists at all. Reading it as the pair is how this spec
      // would have reported a circuit as a TURN success.
      webrtc: connections.some((c) => c.remoteAddr.includes('/webrtc') && !c.limited),
    }
  }, to.peerId)
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-turn-'))
  coturn = await startCoturn()

  stub = createHttpServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      if (request.method === 'OPTIONS') {
        response.writeHead(204)
        response.end()
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { nodeKey?: string }
      void mintFor(body.nodeKey ?? 'unknown').then((grant) => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(grant))
      })
    })
  })
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const address = stub.address()
  stubPort = typeof address === 'object' && address !== null ? address.port : 0

  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // A real anchor rather than `'runs-unsigned-artifacts'`, and the difference is not
    // cosmetic. This relay relays and issues; **nothing in this file runs an artifact at
    // all** — no `runJob`, no `putModule` — so the provenance opt-out would be claiming an
    // exemption this spec has no use for. `trust-anchors.node.test.ts` bounds how far that
    // opt-out spreads through the suite precisely so it is not reached for by reflex.
    trustAnchors: [UNUSED_TRUST_ANCHOR],
  })
  const relayAddress = relay.browserDialableAddrs[0]
  if (relayAddress === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = relayAddress

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
}, 240_000)

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  coturn?.stop()
  await new Promise<void>((resolve) => stub?.close(() => resolve()))
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('NET-12 criterion 1 — the rung carries a pair no direct candidate can', () => {
  it('ARM A: two relay-only tabs connect, with typ relay in the page’s config and an allocation at coturn', async () => {
    mintMode = 'valid'
    mintedNodeKeys = new Set()
    const endpoint = `http://127.0.0.1:${String(stubPort)}/turn-credential`
    const a = await openTab('a', { turnEndpoint: endpoint })
    const b = await openTab('b', { turnEndpoint: endpoint })

    const outcome = await dials(a, b, 90_000)

    // READING 1 — what the page actually handed RTCPeerConnection. Taken from outside the
    // page, and checked for having captured ANYTHING first: a recorder that saw nothing would
    // otherwise make every assertion below vacuously true.
    const configs = await recordedConfigs(a.page)
    expect(configs.length, 'the addInitScript recorder captured no RTCPeerConnection at all').toBeGreaterThan(0)
    const withTurn = configs.filter((config) =>
      JSON.stringify(config.iceServers ?? []).includes('turn:'),
    )
    expect(withTurn.length, `no configuration carried a TURN entry: ${JSON.stringify(configs)}`).toBeGreaterThan(0)
    expect(JSON.stringify(configs)).not.toContain('stun.services.mozilla.com')
    expect(configs.some((config) => config.iceTransportPolicy === 'relay')).toBe(true)

    // READING 2 — the SELECTED candidate pair, from `getStats()`. What was actually used, not
    // what was offered.
    const selected = await selectedLocalCandidateTypes(a.page)
    expect(
      selected.length,
      'no succeeded+nominated candidate pair was found on any RTCPeerConnection this page made',
    ).toBeGreaterThan(0)
    expect(
      selected.every((type: string) => type === 'relay'),
      `the selected candidate pair's local candidate was not typ relay: ${JSON.stringify(selected)}`,
    ).toBe(true)

    // READING 3 — coturn's own log, taken at the server rather than asserted by the thing under
    // test, and asserted PER TAB: criterion 1's clause is "an allocation for each tab's
    // username", and one tab allocating twice would satisfy a bare count.
    const allocated = coturn.allocations()
    expect(allocated.length, `coturn logged no allocation. Its log was:\n${coturn.log()}`).toBeGreaterThan(0)
    const allocatedNodeKeys = new Set(allocated.map((username) => username.split(':')[2] ?? ''))
    for (const nodeKey of mintedNodeKeys) {
      expect(
        allocatedNodeKeys.has(nodeKey),
        `coturn logged no allocation for the tab whose node key is ${nodeKey}. ` +
          `It allocated for: ${[...allocatedNodeKeys].join(', ')}`,
      ).toBe(true)
    }
    expect(mintedNodeKeys.size, 'the two tabs did not present two distinct node keys').toBe(2)
    expect(
      outcome.webrtc,
      `the pair formed no unlimited /webrtc connection under iceTransportPolicy=relay. ` +
        `held=${String(outcome.held)}. coturn log:\n${coturn.log().slice(-2000)}`,
    ).toBe(true)
  }, 200_000)

  it('ARM B (the floor): the same arrangement with no reachable TURN does NOT connect', async () => {
    // Identical in every respect except that there is no rung. If this connects, arm A's
    // `connected === true` is not evidence about TURN and the criterion is unmeasured.
    const a = await openTab('b-a', { turnEndpoint: null })
    const b = await openTab('b-b', { turnEndpoint: null })

    const outcome = await dials(a, b, 45_000)
    const configs = await recordedConfigs(a.page)

    // THE TRAP, asserted FIRST and read where it actually bites — on the no-rung path, from
    // outside the page, against what was really handed to `RTCPeerConnection`.
    //
    // The order is deliberate and was paid for. With the `webrtc` assertion first, a plant that
    // made this path return `{}` reddened *there* — because `{}` drops `iceTransportPolicy`
    // too and the pair then connected directly — and the run never reached the line that names
    // the resurrected default. A red is not automatically the red you wanted.
    expect(configs.length, 'the recorder captured no RTCPeerConnection at all').toBeGreaterThan(0)
    expect(
      JSON.stringify(configs),
      'the four @libp2p/webrtc defaults are back in the live configuration, dead entry included ' +
        '— a path returned a config without an `iceServers` key and `getRtcConfiguration` read ' +
        'that as "use the defaults". This is CORRECTION 2 happening.',
    ).not.toContain('stun.services.mozilla.com')
    expect(JSON.stringify(configs)).toContain('stun.cloudflare.com')

    expect(
      outcome.webrtc,
      'a pair with NO TURN server formed a WebRTC connection under iceTransportPolicy=relay — ' +
        'arm A therefore does not distinguish "connected over TURN" from "connected somehow", ' +
        'and criterion 1 is unmeasured rather than met',
    ).toBe(false)
  }, 150_000)

  it('ARM C: a credential minted already-expired produces no allocation', async () => {
    mintMode = 'already-expired'
    const before = coturn.allocations().length
    const endpoint = `http://127.0.0.1:${String(stubPort)}/turn-credential`
    const a = await openTab('c-a', { turnEndpoint: endpoint })
    const b = await openTab('c-b', { turnEndpoint: endpoint })

    const outcome = await dials(a, b, 45_000)

    expect(outcome.webrtc).toBe(false)
    expect(
      coturn.allocations().length,
      'coturn allocated for an ALREADY-EXPIRED credential',
    ).toBe(before)
    // coturn refused it. Note this refusal is NOT distinguishable from a wrong-secret one by
    // its text; what makes this a statement about expiry is arm A, where the same minter with
    // a future expiry allocated in this same run.
    expect(coturn.log()).toMatch(/error 401/)
  }, 150_000)

  it('ARM D: a short-lived credential works, then stops once its lifetime has passed', async () => {
    mintMode = 'short-lived'
    const endpoint = `http://127.0.0.1:${String(stubPort)}/turn-credential`
    // Margin far below the lifetime, so the FIRST ask is a real cache-fill rather than an
    // instant refetch, and the wait below genuinely crosses the expiry.
    const a = await openTab('d-a', { turnEndpoint: endpoint, refreshMarginMs: 500 })
    const b = await openTab('d-b', { turnEndpoint: endpoint, refreshMarginMs: 500 })

    const first = await dials(a, b, 60_000)
    expect(first.webrtc, 'a short-lived credential must work while it is alive').toBe(true)
    const allocationsWhileAlive = coturn.allocations().length

    // Stop minting fresh credentials, then wait the lifetime out. A tab that refetches gets
    // nothing new to refetch, so what is under test is the SERVER refusing the old one.
    mintMode = 'already-expired'
    await new Promise((resolve) => setTimeout(resolve, SHORT_LIFETIME_MS + 2_000))

    // A fresh gathering, in a NEW pair of contexts: coturn does not re-check a live allocation,
    // so re-using the connected pair would measure nothing about expiry.
    const c = await openTab('d-c', { turnEndpoint: endpoint, refreshMarginMs: 500 })
    const d = await openTab('d-d', { turnEndpoint: endpoint, refreshMarginMs: 500 })
    const afterExpiry = await dials(c, d, 45_000)

    expect(
      afterExpiry.webrtc,
      'an expired credential still carried a WebRTC pair after its lifetime passed',
    ).toBe(false)
    expect(coturn.allocations().length).toBe(allocationsWhileAlive)
  }, 240_000)

  it('OPEN-RELAY HARDENING: an unauthenticated Allocate answers 401', async () => {
    const reading = await unauthenticatedAllocate(coturn.port)

    // The same reading `tools/turn-provider-probe.mjs` took against Cloudflare — `0x0113`
    // error 401 — taken here against the server this spec trusts.
    expect(reading.type).toBe('0x0113')
    expect(reading.errorCode).toBe(401)
  }, 30_000)
})
