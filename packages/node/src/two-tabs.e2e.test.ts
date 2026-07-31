import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-02 — two browser tabs, one machine, a real WebRTC data path.
 *
 * The topology this project is a bet on. Neither tab can accept a connection, so
 * both reserve on a Circuit Relay v2 peer; the relay carries only the SDP exchange,
 * and once ICE completes the job runs over a direct browser-to-browser WebRTC
 * connection with the relay out of the path.
 *
 * Two isolated `BrowserContext`s rather than two pages in one context: each gets its
 * own origin storage, so the tabs share no IndexedDB, no peer identity, and no
 * libp2p state. They are separate nodes in every sense except the machine they run
 * on — which is the one thing this test does not claim.
 *
 * Driven from Node because the pieces live on both sides of the boundary: the relay
 * and the WASM fixture are Node-side, the nodes are browser-side. Vitest's browser
 * mode gives one page per file, so genuine multi-tab work needs Playwright directly.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const tabs: Tab[] = []

/** Open an isolated context, load the page, and start a node in it. */
async function openTab(name: string): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()

  // Surface page errors in the test output; a silent browser failure here is
  // otherwise indistinguishable from a timeout.
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })

  const peerId = await page.evaluate(
    async ([address, store]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      return window.o2.start({ relayAddrs: [address!], blockstoreName: store! })
    },
    [relayAddr, `o2-${name}`],
  )

  const tab: Tab = { name, context, page, peerId }
  tabs.push(tab)
  return tab
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-tabs-'))

  relay = await FabricNode.start({
    // Comfortably above the two tabs, so a refusal cannot be mistaken for a bug.
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  // Root at the repo so workspace packages and their `./src/index.ts` entries
  // resolve without fs.allow gymnastics.
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    // Dependency pre-bundling must stay ON. Several libp2p transitive deps are
    // CommonJS (`netmask`, reached via @libp2p/utils), and without pre-bundling the
    // browser fails on `does not provide an export named 'Netmask'` — an ESM/CJS
    // interop error that looks like a missing module.
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 180_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('NET-02 — two tabs on one machine', () => {
  it('each tab reserves on the relay and gets a dialable /webrtc address', async () => {
    const a = await openTab('a')
    const b = await openTab('b')

    expect(a.peerId).not.toBe(b.peerId)

    const [aAddrs, bAddrs] = await Promise.all([
      a.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000)),
      b.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000)),
    ])

    for (const [tab, addrs] of [
      [a, aAddrs],
      [b, bAddrs],
    ] as const) {
      expect(addrs.length).toBeGreaterThan(0)
      // A browser's WebRTC address is expressed through the relay that will carry
      // its SDP exchange — it cannot exist standalone.
      expect(addrs[0]).toContain('/webrtc')
      expect(addrs[0]).toContain(relay.peerId)
      expect(addrs[0]).toContain(tab.peerId)
    }

    // Both reservations are held simultaneously.
    expect(relay.capacity.granted).toBeGreaterThanOrEqual(2)
    expect(relay.capacity.atCapacity).toBe(false)
  }, 180_000)

  it('completes a 2x-redundant map job over a direct WebRTC connection', async () => {
    const [a, b] = tabs as [Tab, Tab]

    const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
    const target = bAddrs[0]!

    // Tab A dials tab B at its /webrtc address. The relay signals; the resulting
    // connection is direct.
    const dialed = await a.page.evaluate(async (address) => window.o2.dial(address), target)
    expect(dialed).toBe(b.peerId)
    expect(await a.page.evaluate(() => window.o2.peers())).toContain(b.peerId)

    // THE claim of this phase: the relay carried only the SDP exchange, and the data
    // path is a direct WebRTC connection. libp2p marks a relayed circuit as
    // *limited* (2 min / 128 KiB); a WebRTC connection has no such limits. If the
    // job were running over the relay this assertion is what would catch it.
    const connections = await a.page.evaluate(
      async (peer) => window.o2.connectionsTo(peer),
      b.peerId,
    )
    expect(connections.length).toBeGreaterThan(0)
    const webrtc = connections.filter((c) => c.remoteAddr.includes('/webrtc'))
    expect(webrtc.length).toBeGreaterThan(0)
    for (const connection of webrtc) expect(connection.limited).toBe(false)

    // Only tab A holds the module. Tab B has a fresh IndexedDB and must pull it.
    const moduleCid = await a.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )

    const report = await a.page.evaluate(
      async ([cid, peer]) =>
        window.o2.runJob({
          moduleCid: cid!,
          peerIds: [peer!],
          shards: 4,
          redundancy: 2,
          // A submits and also executes; B executes. Two tabs, 2x redundancy.
          includeSelf: true,
        }),
      [moduleCid, b.peerId],
    )

    expect(report.complete).toBe(true)
    expect(report.partitions).toEqual([0, 1, 2, 3])
    for (const replicas of report.replicas) expect(replicas).toBe(2)
    for (const agreeing of report.agreeing) {
      expect([...agreeing].sort()).toEqual([a.peerId, b.peerId].sort())
    }
    expect(report.verificationMultiplier).toBeCloseTo(2, 6)
    expect(report.rejected).toBe(0)

    // Criterion 2 — the manifest reaches the demo's real entry point (`runJob`,
    // called through `window.o2` exactly as a visitor's page does), not only a
    // test-side harness that builds its own `EgressGuard`. Both `entries.length`
    // and `violations` are checked, per 13-CONTEXT.md decision 3: a manifest with
    // zero entries reports zero violations trivially, and the two must never be
    // allowed to look alike.
    expect(report.egress.entries.length).toBeGreaterThan(0)
    expect(report.egress.violations).toEqual([])
  }, 240_000)

  it('leaves the pulled blocks in the second tab’s IndexedDB', async () => {
    const [a, b] = tabs as [Tab, Tab]

    // The module was only ever put into tab A. Tab B pulled it over the WebRTC
    // connection during the job, and it persisted browser-side — DATA-02 holding on
    // the real path rather than in a unit test.
    const moduleCid = await a.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )

    expect(await b.page.evaluate(async (cid) => window.o2.hasBlock(cid), moduleCid)).toBe(true)

    // Blocks: the module, plus one input per shard from the previous test.
    const stored = await b.page.evaluate(async () => window.o2.storedBlocks())
    expect(stored).toBeGreaterThanOrEqual(1 + 4)
  }, 120_000)

  /**
   * The panel may not present an aggregate that cannot exist.
   *
   * `serveAgent`'s report branch is the only absorber of a peer's start outcome, and
   * every production call site opts out of it with the `'keeps-no-ledger'` sentinel.
   * So a merged report can only ever contain this tab's own outcome, however many
   * peers were asked, and a peer count rendered beside it reads as a tally of
   * contributors. The mechanism is correct; the render was the lie.
   *
   * **This assertion is about the claim, not the string.** An author who reintroduces
   * an aggregate under different words will not be caught here. Saying so is more
   * useful than pretending an absence assertion is stronger than it is.
   *
   * This file runs in the `e2e` project only, so nothing about it is visible to the
   * `npm run test:unit` loop.
   */
  it('renders no peer aggregate beside a report that can only hold this tab', async () => {
    const [a] = tabs as [Tab]

    // `page.evaluate`, not a locator click: `#refresh-report` lives inside `#main`,
    // which stays hidden until `reveal()` runs on a button press, and this harness
    // drives `window.o2` directly rather than clicking Start. A locator click would
    // fail actionability and the test would go red for the wrong reason.
    await a.page.evaluate(() => {
      document.getElementById('refresh-report')?.click()
    })
    await a.page.waitForFunction(
      () => (document.getElementById('report')?.textContent ?? 'not asked yet') !== 'not asked yet',
      null,
      { timeout: 30_000 },
    )
    const panel = await a.page.evaluate(() => document.getElementById('report')?.textContent ?? '')

    // The load-bearing assertion.
    expect(panel).not.toContain('peers answering')

    // And the paired positive, so an absent instrument cannot masquerade as a
    // passing absence. `openTab` calls `grantConsent()` bare, so `reportingAllowed`
    // is false, `startReport` sends `outcome: null`, nothing is recorded anywhere and
    // `describeStartReport` returns exactly this. A non-zero branch would need a tab
    // opened with `grantConsent({ reporting: true })`, which is a different change.
    expect(panel).toContain('no start outcomes reported')

    // That same bare `grantConsent()` is one visitor declining to be counted, and the
    // running-node path is the only place that count could be dropped — no unit test
    // can import the demo glue that passes it.
    expect(panel).toContain('not counted: 1')
  }, 120_000)
})
