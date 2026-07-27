import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RELAY_MAX_RESERVATIONS } from '@o2/libp2p'
import { FabricNode } from './fabric-node.ts'

/**
 * Criterion 3 — sixteen browser peers reserving against one tuned relay.
 *
 * Sixteen is the specific number that fails without tuning: libp2p's default is
 * fifteen (`DEFAULT_MAX_RESERVATION_STORE_SIZE`), so this measures whether the
 * relay's capacity is genuinely configurable rather than nominally so.
 *
 * These are real browser peers — sixteen pages, each with its own libp2p node, its own
 * peer identity, and its own IndexedDB database. One `BrowserContext` holds them
 * because sixteen contexts is a great deal of memory for no additional signal: the
 * thing under test is the relay's reservation accounting, and distinct database names
 * already keep the nodes' storage apart.
 *
 * Scope, stated plainly: the criterion also asks for peers to *hold* for over an hour
 * under churn, and for relayed byte counters per peer. Neither is here — an hour-long
 * test does not belong in this suite, and js-libp2p exposes no per-peer relayed byte
 * counter to assert on. What is verified is that sixteen reservations are granted and
 * held simultaneously, and that not one of them is refused.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const PEERS = 16

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let baseUrl: string

beforeAll(async () => {
  // Above sixteen so a refusal means a real failure rather than a configured limit.
  relay = await FabricNode.start({ maxReservations: 32, listen: ['/ip4/127.0.0.1/tcp/0/ws'] })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
  context = await browser.newContext()
}, 240_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
}, 180_000)

describe('criterion 3 — simultaneous browser reservations', () => {
  it(`grants and holds ${PEERS} reservations, one more than libp2p's default allows`, async () => {
    // The premise of the test: the default would not have been enough.
    expect(PEERS).toBeGreaterThan(RELAY_MAX_RESERVATIONS)

    const pages: Page[] = []
    for (let i = 0; i < PEERS; i++) {
      const page = await context.newPage()
      page.on('pageerror', (error) => {
        process.stderr.write(`[peer${i}] page error: ${error.message}\n`)
      })
      await page.goto(`${baseUrl}${PAGE}`)
      await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
      pages.push(page)
    }

    // Start every node, then wait for all of them — so the reservations really are
    // concurrent rather than sixteen sequential ones that each release first.
    const peerIds = await Promise.all(
      pages.map(async (page, i) =>
        page.evaluate(
          async ([address, store]) => {
            window.o2.grantConsent()
            return window.o2.start({ relayAddrs: [address!], blockstoreName: store! })
          },
          [relayAddr, `o2-many-${i}`],
        ),
      ),
    )
    expect(new Set(peerIds).size).toBe(PEERS)

    const addrSets = await Promise.all(
      pages.map(async (page) => page.evaluate(async () => window.o2.waitForWebrtcAddr(120_000))),
    )
    for (const addrs of addrSets) expect(addrs.length).toBeGreaterThan(0)

    // All sixteen held at the same moment.
    expect(relay.capacity.granted).toBe(PEERS)
    expect(relay.capacity.atCapacity).toBe(false)
    expect(relay.capacity.remaining).toBe(32 - PEERS)

    for (const page of pages) await page.close()
  }, 600_000)
})
