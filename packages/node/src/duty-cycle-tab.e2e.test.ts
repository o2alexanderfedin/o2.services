import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeRequest, parseResponse } from '@o2/net'
import { FabricNode } from './fabric-node.ts'

/**
 * SCHED-04 on the browser tier: a user CPU cap set on a **live tab**, composed over the
 * visibility governor rather than replacing it.
 *
 * ## What this file measures
 *
 * On a real page, in a real Chromium, against a real Node-tier peer:
 *
 * - the cap is settable at runtime and the tab's advertised slot count follows it;
 * - the composition binds from both sides — a user cap below 1 lowers the effective rate
 *   on a visible tab, and backgrounding lowers it at a user cap of 1;
 * - a cap outside `(0, 1]` throws in the page and changes nothing;
 * - **a peer reads the tab's advertised slot count off the wire**, before and after one
 *   `setDutyCycle` call — criterion 3's *"observable in what the requestor is offered
 *   next"*, taken on the browser tier by the peer rather than by the page.
 *
 * ## The peer-side reading, and the argument it replaces
 *
 * This section used to say that reading was out of reach here: that it would need "a
 * Node-tier `FabricNode` dialling a browser", that "no test in this repository does that
 * yet", and that this was "transport ground this plan has no business breaking on the way
 * past". The first two are false now, and the third was already false when it was
 * written — `browser-capability.e2e.test.ts` had broken exactly that ground, driving real
 * frames between a Node `FabricNode` and a live tab over a direct WebSocket the tab
 * opened itself. The last case below follows that topology.
 *
 * What stood in its place was an argument from shared construction: `LocalCapacity`
 * reading a governor is the same object on both tiers, constructed the same way in
 * `browser-node.ts` and `fabric-node.ts`, so the Node-tier reading in
 * `duty-cycle.node.test.ts` was offered as covering the browser's as well. That argument
 * is sound, and it is still not a measurement — which is the distinction criterion 3
 * turns on. The criterion names both tiers and asks for an effect *observable in what the
 * requestor is offered next*, and an observable nobody observed is a statement about the
 * code rather than a reading of it. What the difference is worth is recorded as mutation
 * `M37`: a browser-tier slot count wired to a fixed number leaves every in-page assertion
 * in this file green and turns only the peer's reading red.
 *
 * ## A direct WebSocket, not a relayed circuit
 *
 * The peer that takes the reading is a **second** Node-tier node, and it is deliberately
 * not the relay: it reserves nothing for anybody, so a circuit through it does not exist
 * to be taken by accident. The tab dials its `/ws` listener itself, and the case still
 * asserts that the connection carrying the `offer` frames is unlimited and holds no
 * `/p2p-circuit` hop — the transport's own answer rather than this file's.
 * `.planning/PROJECT.md` fixes a relayed circuit as a signalling channel — 2 minutes,
 * 128 KiB — that may not carry a job, so a capacity reading leaning on one would rest on
 * a path the project says is for something else.
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
let peer: FabricNode
let peerAddr: string
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
    relayAdmission: 'admits-any-peer',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  // The peer that takes the wire reading. **No `maxReservations`**, so it is not a relay
  // server and holds no reservation for the tab — the connection between them can only be
  // the direct WebSocket the tab opens below, which is the property the last case asserts
  // rather than assumes. It executes nothing either, so it needs no trust anchor of
  // substance for the same reason the relay does not.
  peer = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const peerAddress = peer.browserDialableAddrs[0]
  if (peerAddress === undefined) throw new Error('peer produced no browser-dialable address')
  peerAddr = peerAddress

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
  await peer?.stop().catch(() => {})
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

/**
 * An offer probe from the Node side, reading the raw reply rather than a flattening —
 * the same helper shape `duty-cycle.node.test.ts` uses for the Node-tier reading, so the
 * two tiers' readings are comparable line for line rather than merely similar in spirit.
 */
async function offerToTab(tabPeerId: string, shardId: string): Promise<{ slots: number; inFlight: number }> {
  const reply = parseResponse(await peer.rpc.request(tabPeerId, encodeRequest({ kind: 'offer', shardId })))
  if (reply?.kind !== 'offer') throw new Error(`expected an offer answer, got ${String(reply?.kind)}`)
  if (reply.capacity === null || reply.capacity === undefined) {
    // A node that answers an offer while stating no capacity is the `accepts-every-offer`
    // sentinel wired in place of a real `LocalCapacity`. Named here rather than left to
    // surface as `expected null to equal { slots: 8 … }`, because that is a different
    // defect from a wrong slot count and the two must not read alike.
    throw new Error('the tab answered the offer but stated no capacity at all')
  }
  return reply.capacity
}

describe('a Node peer reads the tab’s advertised capacity across a cap change', () => {
  it('sees the slot count fall from 8 to 2, off the wire', async () => {
    const page = await openPage('peer-read')
    const tabPeerId = (await page.evaluate(() => window.o2.addresses())).peerId
    expect(tabPeerId).not.toBe(peer.peerId)

    // The tab opens the connection, because a browser cannot listen — the transport
    // matrix in `CLAUDE.md` lists WebSockets as browser→server only. The Node side
    // answers back along it: `Libp2pTransport.send` dials by `PeerId`
    // (`libp2p-transport.ts:339`), which resolves to the open connection rather than to
    // a new one, so nothing here needs the tab to be dialable.
    await page.evaluate((address) => window.o2.dial(address), peerAddr)
    expect(await page.evaluate(() => window.o2.peers())).toContain(peer.peerId)

    // ---- The path the reading travels, asserted rather than assumed. ------------
    // `limited` is libp2p's own mark for a relayed circuit (2 min / 128 KiB), so this is
    // the transport's answer to "is this a circuit", not this file's. Without it the case
    // would still pass over a circuit and would quietly be measuring capacity across the
    // one path `.planning/PROJECT.md` says may not carry work.
    const connections = await page.evaluate((id) => window.o2.connectionsTo(id), peer.peerId)
    expect(connections.length).toBeGreaterThan(0)
    expect(connections.map((c) => c.limited)).not.toContain(true)
    expect(connections.filter((c) => c.remoteAddr.includes('p2p-circuit'))).toStrictEqual([])
    expect(connections.some((c) => c.remoteAddr.includes('/ws'))).toBe(true)

    // ---- Both values are read, not only the capped one. -------------------------
    // A case that asserted only `slots: 2` would pass against a tab that had been capped
    // since it started, which proves nothing about a cap reaching the wire.
    expect(await offerToTab(tabPeerId, 'tab-before')).toEqual({ slots: 8, inFlight: 0 })

    await page.evaluate(() => {
      window.o2.setDutyCycle(0.25)
    })

    // ---- The observable, from the peer's side. ----------------------------------
    // Every other reading in this file goes through `page.evaluate`, which can only show
    // that the setter ran — the thing 18-09 already established. This one is the answer
    // the tab put on the wire, composed by the tab's own `LocalCapacity` and parsed by a
    // different process. It is the browser-tier twin of `duty-cycle.node.test.ts:101-104`.
    expect(await offerToTab(tabPeerId, 'tab-after')).toEqual({ slots: 2, inFlight: 0 })

    // The in-page reading agrees, and is stated last and deliberately: it is the
    // corroboration, not the evidence. Planted defect `M37` separates them — it leaves
    // this line green and turns the two above it red.
    expect(await page.evaluate(() => window.o2.capacity())).toEqual({ dutyCycle: 0.25, slots: 2 })
  }, 180_000)
})
