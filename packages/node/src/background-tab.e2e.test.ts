import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { CID } from 'multiformats/cid'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signName, toHex } from '@o2/core'
import type { TabNameRecord } from '@o2/browser'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
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

/** The `keypair(seed)` fixture from `packages/core/src/naming.test.ts`. */
function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

/**
 * DET-03/DATA-08 — the build authority for the fixture module the job below runs.
 *
 * Every tab here pins `harness.pub` and nothing else, **replacing** the demo's default
 * anchor rather than joining it (see `TabApi.start`). Correct here for the same reason
 * as in `two-tabs.e2e.test.ts`: the module under test is a fixture this harness built,
 * so the harness is its build authority and the demo's has no standing over it.
 *
 * Seed 53 is distinct from every other fixture key in the repository, including 51 and
 * 52 in `two-tabs.e2e.test.ts`, so a mixed-up key produces a clear untrusted-signer
 * refusal rather than an accidental pass. This file's subject is throttling, not
 * provenance — the refusal proof lives in `two-tabs.e2e.test.ts` — and what a signed
 * dispatch buys here is that BROW-03's reading is taken on the path the demo actually
 * ships rather than on one the guard was switched off for.
 */
const harness = keypair(53)

/** Sign `cid` for the fixture module, in the shape that survives `page.evaluate`. */
function signFixture(cid: string): TabNameRecord {
  // `TabNameRecord` carries the CID as a string because structured cloning does not
  // preserve a `CID` instance; that reason is written down once, on the type itself.
  const record = signName(harness.priv, {
    name: 'o2-background-tab-partition-fixture',
    cid: CID.parse(cid),
    version: 1,
    expiresAt: Date.now() + 300_000,
  })
  return { ...record, cid: record.cid.toString() }
}

/** Load the page in an existing context and start a node in it. */
async function openPage(name: string): Promise<Page> {
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })
  await page.evaluate(
    async ([address, store, anchor]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      // DET-03: this tab runs a module exactly when `harness` signed for it — see above.
      return window.o2.start({
        relayAddrs: [address!],
        blockstoreName: store!,
        trustAnchors: [anchor!],
      })
    },
    [relayAddr, `o2-bg-${name}`, harness.pub],
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
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
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
      async ([address, store, anchor]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      // DET-03: the same anchor `openPage` pins, stated here too because this case
      // starts its own node rather than going through it.
      return window.o2.start({
        relayAddrs: [address!],
        blockstoreName: store!,
        trustAnchors: [anchor!],
      })
    },
      [relayAddr, 'o2-bg-iso2', harness.pub],
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

    // Background the worker tab, and read the governor back in the **same round trip**
    // that backgrounds it.
    //
    // That ordering is the assertion. `simulateHidden` shadows the two getters and
    // dispatches a genuine `visibilitychange` synchronously (`demo/main.ts:582-592`),
    // so a governor that reacts *to the event* has already throttled before this
    // `evaluate` returns its value. One that polled for the flag, or deferred to a
    // timer or a microtask, would still read `hidden: false` here. BROW-03 asks for
    // "within a second"; what the implementation actually guarantees is "before the
    // call that hid it comes back", and this asserts the guarantee rather than the
    // requirement's rounder restatement of it.
    //
    // What was here before was `Date.now()` either side of an `evaluate` plus a
    // `waitForFunction`, bounded at 1 s — the figure from the requirement prose, not
    // from measurement, and nested inside a 5 s poll, so the bound and its own wait
    // disagreed by 5×. It could not measure the governor at all: because the handler
    // is synchronous, the wait was satisfied on its first poll every time and the
    // reading was two Playwright CDP round trips across a process boundary and
    // nothing else. Its only available failure was a slow round trip — a false one.
    const afterDispatch = await worker.evaluate(() => {
      window.o2.simulateHidden(true)
      return window.o2.governor()
    })
    expect(afterDispatch.hidden).toBe(true)
    expect(afterDispatch.dutyCycle).toBeLessThan(1)
    expect(afterDispatch.transitions).toBe(1)

    // And it is still throttled once the dust settles, rather than having flipped back
    // — a separate round trip, so this is the state the tab holds, not the state the
    // dispatch left on the stack.
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

    // DET-03: both tabs pin `harness.pub`, so the fixture needs a record that key signed
    // for this exact CID. The subject below is still throttling — this is what keeps that
    // reading on the signed path rather than on one with the guard switched off.
    const record = signFixture(moduleCid)

    // Start the job, then background the *worker* tab while its shards are in flight.
    // Its executor is governed, so it throttles — but must not drop the work.
    const jobPromise = submitter.evaluate(
      async ([cid, peer, signed]) =>
        window.o2.runJob({
          moduleCid: cid as string,
          moduleRecord: signed as TabNameRecord,
          peerIds: [peer as string],
          shards: 6,
          redundancy: 1,
        }),
      [moduleCid, workerPeerId, record] as const,
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
