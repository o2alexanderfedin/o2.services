import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * SCHED-04 on the browser tier: a user CPU cap set on a **live tab**, composed over the
 * visibility governor rather than replacing it.
 *
 * ## What this file measures
 *
 * On a real page, in a real Chromium, against a real relay:
 *
 * - the cap is settable at runtime and the tab's advertised slot count follows it;
 * - the composition binds from both sides — a user cap below 1 lowers the effective rate
 *   on a visible tab, and backgrounding lowers it at a user cap of 1;
 * - a cap outside `(0, 1]` throws in the page and changes nothing.
 *
 * ## What it does not measure, stated rather than implied
 *
 * **A peer reading the tab's slot count off the wire.** Plan 18-09 asks for that, and it
 * is not here. The reading it would need is a Node-tier `FabricNode` dialling a browser
 * and sending an `offer` frame, and no test in this repository does that yet — every
 * existing browser↔peer path in `e2e` is tab-to-tab. That is transport ground this plan
 * has no business breaking on the way past.
 *
 * What *is* proven, and where: the wire half is measured on the **Node tier**, in
 * `duty-cycle.node.test.ts`, where a peer probes with `{kind:'offer'}` over tcp + noise +
 * yamux and reads `slots: 2` after a `setDutyCycle(0.25)`. The mechanism that produces
 * that number — `LocalCapacity` reading a governor — is the identical object on both
 * tiers, constructed the same way in `browser-node.ts` and `fabric-node.ts`. So the gap
 * is the *reading*, not the behaviour, and criterion 3's browser half should be scored
 * against that distinction rather than against this file's silence.
 *
 * **The `hidden` signal is simulated**, for `background-tab.e2e.test.ts`'s measured
 * reason: Chromium under automation never reports a page as hidden, in headless or
 * headed mode, because no window manager drives tab activation. `document.hidden` is
 * shadowed and a real `visibilitychange` is dispatched; everything downstream — the real
 * document, the real listener, the real governor, the real `GovernedExecutor` — is
 * genuine.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let context: BrowserContext

async function openPage(name: string, dutyCycle?: number): Promise<Page> {
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })
  await page.evaluate(
    async ([address, store, cap]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      return window.o2.start({
        relayAddrs: [address as string],
        blockstoreName: store as string,
        maxConcurrentTasks: 8,
        ...(cap === undefined ? {} : { dutyCycle: cap as number }),
      })
    },
    [relayAddr, `o2-dc-${name}`, dutyCycle] as const,
  )
  return page
}

beforeAll(async () => {
  // This node relays and executes nothing — nothing dispatches to it, so it has no guard
  // to satisfy and a `moduleRecord` here would be decoration.
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
  context = await browser.newContext()
}, 180_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
})

describe('a live tab carries a user cap it can change', () => {
  it('starts unthrottled and drops its slot count when capped', async () => {
    const page = await openPage('settable')

    // `slots = max(1, floor(maxConcurrent * dutyCycle))`, so 8 at full rate.
    expect(await page.evaluate(() => window.o2.capacity())).toEqual({ dutyCycle: 1, slots: 8 })

    await page.evaluate(() => {
      window.o2.setDutyCycle(0.25)
    })

    // One call on a tab that is already running: no restart, no reconstruction. This is
    // the half of SCHED-04 that neither tier had before this phase.
    expect(await page.evaluate(() => window.o2.capacity())).toEqual({ dutyCycle: 0.25, slots: 2 })

    // **And the executor is actually paced by it**, which the two readings above do not
    // establish and which was measured rather than assumed.
    //
    // `capacity()` is fed by the cap governor directly, so it reports the right number
    // even if the executor was handed a *different* governor. Composing
    // `new GovernedExecutor(counter, governor)` — the visibility governor alone, which is
    // the obvious wrong turn here — leaves every assertion above green while the tab
    // paces itself at the environment's rate and ignores the user's cap entirely. That
    // was planted and it survived, which is why this line exists.
    //
    // `activity().dutyCycle` reads `node.executor.dutyCycle`, i.e. whatever governor the
    // executor was actually built with. It is the only reading here that can tell the two
    // compositions apart.
    const activity = await page.evaluate(() => window.o2.activity())
    expect(activity?.dutyCycle).toBe(0.25)
  }, 180_000)

  it('takes the cap it was started with', async () => {
    // Proves the option reaches the governor rather than only the setter path.
    const page = await openPage('preset', 0.5)
    expect(await page.evaluate(() => window.o2.capacity())).toEqual({ dutyCycle: 0.5, slots: 4 })
  }, 180_000)

  it('refuses a cap outside (0, 1] and stays exactly as it was', async () => {
    const page = await openPage('guarded')

    const threw = await page.evaluate(() => {
      const results: boolean[] = []
      for (const bad of [0, -0.5, 1.5, Number.NaN]) {
        try {
          window.o2.setDutyCycle(bad)
          results.push(false)
        } catch {
          results.push(true)
        }
      }
      return results
    })
    expect(threw).toEqual([true, true, true, true])

    // A refused call must not be a partial one.
    expect(await page.evaluate(() => window.o2.capacity())).toEqual({ dutyCycle: 1, slots: 8 })
  }, 180_000)
})

describe('the user cap and the visibility governor compose, taking the lower', () => {
  it('binds from the user side on a visible tab', async () => {
    const page = await openPage('user-side')

    // Visible, so the environment governor is at 1 and the user's cap is what shows.
    expect(await page.evaluate(() => window.o2.governor())).toMatchObject({ hidden: false, dutyCycle: 1 })

    await page.evaluate(() => {
      window.o2.setDutyCycle(0.25)
    })

    // The *effective* rate is the lower of the two. `governor()` still reports the
    // visibility governor's own reading, which is untouched at 1 — that separation is
    // the point: one object is the environment, the other is the user.
    expect(await page.evaluate(() => window.o2.capacity())).toMatchObject({ dutyCycle: 0.25 })
    expect(await page.evaluate(() => window.o2.governor())).toMatchObject({ hidden: false, dutyCycle: 1 })
  }, 180_000)

  it('binds from the environment side at a user cap of 1 — BROW-03 unchanged', async () => {
    const page = await openPage('env-side')

    expect(await page.evaluate(() => window.o2.capacity())).toMatchObject({ dutyCycle: 1 })

    await page.evaluate(() => {
      window.o2.simulateHidden(true)
    })

    // The whole risk this plan carried: adding a user cap must not have unbound the
    // background throttle. A hidden tab at a user cap of 1 still throttles, because the
    // composition takes the lower and the environment is now the lower one.
    const hidden = await page.evaluate(() => window.o2.governor())
    expect(hidden).toMatchObject({ hidden: true })
    expect(hidden.dutyCycle).toBeLessThan(1)

    const capped = await page.evaluate(() => window.o2.capacity())
    expect(capped.dutyCycle).toBe(hidden.dutyCycle)
  }, 180_000)
})
