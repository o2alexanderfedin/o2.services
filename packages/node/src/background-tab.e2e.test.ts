import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * BROW-03 / BROW-05 — criterion 6.
 *
 * Two things a visitor's browser has to be true for this project to be allowed to
 * run at all:
 *
 *   - backgrounding the tab throttles compute quickly, and returning to it resumes
 *     without losing the job;
 *   - the node works on an ordinary page with no COOP/COEP headers, because the
 *     declared hosting target cannot send any.
 *
 * ## One honest limitation
 *
 * **Chromium under automation never reports a page as hidden.** Verified directly:
 * `page.bringToFront()` changes nothing and fires no `visibilitychange`, in headless
 * *and* headed mode, because no window manager is driving tab activation. There is no
 * CDP visibility override either — `Page.setWebLifecycleState` only offers
 * frozen/active, which fires `freeze` rather than `visibilitychange`.
 *
 * So the browser's *signal* is simulated — `document.hidden` is shadowed and a real
 * `Event('visibilitychange')` is dispatched — and everything downstream is genuine:
 * the real `document`, real event dispatch, the governor's real listener, the real
 * `GovernedExecutor`, and a real job over a real WebRTC connection. What is *not*
 * proven here is that Chromium fires the event when a user switches tabs; that is
 * documented browser behaviour, and the governor's own state machine is covered
 * exhaustively against an injected source in `visibility-governor.test.ts`.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let context: BrowserContext

/** Load the page in an existing context and start a node in it. */
async function openPage(name: string): Promise<Page> {
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })
  await page.evaluate(
    async ([address, store]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      return window.o2.start({ relayAddrs: [address!], blockstoreName: store! })
    },
    [relayAddr, `o2-bg-${name}`],
  )
  return page
}

beforeAll(async () => {
  // DET-03: this node's subject is relaying, not provenance, and nothing dispatches to
  // it — it carries the tabs' handshake and executes nothing. Saying so out loud is the
  // whole benefit of `trustAnchors` being required: a reader counting this literal
  // learns exactly which tests do not exercise the signed path. No job here carries a
  // `moduleRecord` either, because a node running with the opt-out has no guard to
  // satisfy and a record would be decoration the next reader would mistake for a
  // requirement.
  relay = await FabricNode.start({
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
  // One context, several pages: that is what makes bringToFront actually hide the
  // other page. Separate contexts are separate windows and both stay visible.
  context = await browser.newContext()
}, 180_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
}, 120_000)

describe('BROW-05 — runs on a page with no COOP/COEP', () => {
  it('is not cross-origin isolated, and works anyway', async () => {
    const page = await openPage('iso')

    const response = await page.goto(`${baseUrl}${PAGE}`)
    const headers = response?.headers() ?? {}
    // The declared hosting target serves no custom headers, so the node has to work
    // without them. Asserting their absence keeps a future dev-server change from
    // quietly making the test easier than reality.
    expect(headers['cross-origin-opener-policy']).toBeUndefined()
    expect(headers['cross-origin-embedder-policy']).toBeUndefined()

    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })
    await page.evaluate(
      async ([address, store]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      return window.o2.start({ relayAddrs: [address!], blockstoreName: store! })
    },
      [relayAddr, 'o2-bg-iso2'],
    )

    const isolation = await page.evaluate(() => window.o2.isolation())
    expect(isolation.crossOriginIsolated).toBe(false)
    // Without cross-origin isolation there is no SharedArrayBuffer — which is why
    // WASM threads are off the table for this tier, and why each executor gets its
    // own instance instead.
    expect(isolation.hasSharedArrayBuffer).toBe(false)

    // And the node still reserved and became addressable.
    const addrs = await page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
    expect(addrs.length).toBeGreaterThan(0)
    await page.close()
  }, 180_000)
})

describe('BROW-03 — backgrounding throttles, returning resumes', () => {
  it('throttles within a second of being hidden and restores on return', async () => {
    const worker = await openPage('worker')

    expect(await worker.evaluate(() => window.o2.governor())).toMatchObject({
      hidden: false,
      dutyCycle: 1,
      transitions: 0,
    })

    // Background the worker tab and measure end to end: from this action to the tab
    // reporting itself throttled. Measured here rather than in the governor, because a
    // latency the governor computed about its own handler would be zero by
    // construction and would prove nothing.
    const hiddenAt = Date.now()
    await worker.evaluate(() => window.o2.simulateHidden(true))
    await worker.waitForFunction(() => window.o2.governor().hidden, null, { timeout: 5_000 })
    const throttledWithinMs = Date.now() - hiddenAt

    expect(throttledWithinMs).toBeLessThan(1_000)

    const throttled = await worker.evaluate(() => window.o2.governor())
    expect(throttled.hidden).toBe(true)
    expect(throttled.dutyCycle).toBeLessThan(1)
    expect(throttled.transitions).toBe(1)

    // Return to the tab.
    await worker.evaluate(() => window.o2.simulateHidden(false))
    await worker.waitForFunction(() => !window.o2.governor().hidden, null, { timeout: 5_000 })

    const restored = await worker.evaluate(() => window.o2.governor())
    expect(restored.hidden).toBe(false)
    expect(restored.dutyCycle).toBe(1)
    expect(restored.transitions).toBe(2)

    await worker.close()
  }, 180_000)

  it('finishes a job that was running when the tab went to the background', async () => {
    const submitter = await openPage('sub')
    const worker = await openPage('bgworker')

    const workerAddrs = await worker.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
    await submitter.evaluate(async (address) => window.o2.dial(address), workerAddrs[0]!)
    const workerPeerId = await worker.evaluate(() => window.o2.addresses().peerId)

    const moduleCid = await submitter.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )

    // Start the job, then background the *worker* tab while its shards are in flight.
    // Its executor is governed, so it throttles — but must not drop the work.
    const jobPromise = submitter.evaluate(
      async ([cid, peer]) =>
        window.o2.runJob({ moduleCid: cid!, peerIds: [peer!], shards: 6, redundancy: 1 }),
      [moduleCid, workerPeerId],
    )

    await worker.evaluate(() => window.o2.simulateHidden(true))
    await worker.waitForFunction(() => window.o2.governor().hidden, null, { timeout: 5_000 })

    const report = await jobPromise

    // "Resumes on return without losing its job": every shard completed despite the
    // worker being throttled mid-flight.
    expect(report.complete).toBe(true)
    expect(report.partitions).toEqual([0, 1, 2, 3, 4, 5])

    const governor = await worker.evaluate(() => window.o2.governor())
    expect(governor.hidden).toBe(true)
    // The throttle was actually paid rather than merely configured.
    expect(governor.sleptMs).toBeGreaterThan(0)

    await submitter.close()
    await worker.close()
  }, 240_000)
})
