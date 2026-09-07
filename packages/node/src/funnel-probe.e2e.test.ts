import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { FUNNEL_SCHEMA_DIGEST, FUNNEL_STAGES } from '@o2/net'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { funnelEndpointFromRelay } from '../../browser/src/funnel-reporter.ts'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { registerHarnessTab } from './e2e-signin.ts'

/**
 * A derived collector is probed before it is targeted — RUN-07, read at the stand-in's own log.
 *
 * ## The defect, which cost a real run and is not hypothetical
 *
 * `funnelEndpointFromRelay` derives the collector from the relay a tab bootstrapped through.
 * That is true of the deployed Worker and **false of any self-hosted seed**, which serves
 * libp2p WebSocket on that port and answers `400`. The beacon fails immediately, so nothing
 * hangs and nothing is logged: the funnel *looks configured and collects nothing*. Criterion 2
 * asks for a funnel *"reporting live at the moment the first invite is sent"*, so a silent drop
 * is a criterion-2 failure that presents as a criterion-2 pass — and `RUN-07`'s staged go/no-go
 * cannot tell "nobody came" from "nothing was collected" while it is possible.
 *
 * ## Why the reading is a second server's log and not a page-side request list
 *
 * `artifact-fetch-gate.e2e.test.ts` states the rule this file follows: *"not 'the tab did not
 * ask for anything suspicious' but 'nobody was asked'"*. A `page.on('request')` list sees what
 * the tab tried to issue; the stand-in's log sees what **arrived**. The claim here is about what
 * a collector receives, so the collector's own log is the instrument.
 *
 * ## Arm B is what makes arm A's zero a measurement
 *
 * The two arms differ in **one** thing: what the stand-in answers on `/funnel`. Same page, same
 * relay address, same consent, same start. Without arm B, arm A passes on any page that never
 * reached the funnel at all — which is the absence-with-no-positive-control failure this
 * repository has already shipped once, and the reason the whole funnel exists.
 *
 * ## The second instrument, and the control ON it
 *
 * `funnel.active` is module state in `demo/main.ts`, so it is read through that file's own
 * `funnelFacts()` export — the `signinFacts` route, not a new `window.o2` method. A dynamic
 * import that resolved to a *different* module instance would answer `active: false` for a
 * reason that has nothing to do with a collector, so every read below also asserts `furthest`
 * is `'consent'`: a fresh instance re-runs `funnel.enter('page-load')` on a reporter nobody
 * armed and answers `'page-load'`.
 *
 * ## Scope fence
 *
 * Two local servers on ephemeral ports and one Chromium. Nothing deployed, nothing paid for,
 * no Cloudflare resource created — the stand-in IS the collector, and it is this process.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'

/**
 * The module URL a fixture imports to reach the page's own reporter.
 *
 * The same specifier `index.html` resolves `./main.ts` to, so the browser's module registry
 * hands back the instance the page is already running rather than building a second one. That
 * it really is the same instance is not assumed — see `furthest` in every read below.
 */
const MAIN_MODULE = '/packages/browser/demo/main.ts'

/**
 * A peer id in the address the page is handed.
 *
 * Load-bearing only in that it must PARSE: `funnelEndpointFromRelay` runs the address through
 * `multiaddr()`, and a malformed one answers `null`, which would leave both arms silent for a
 * reason that looks exactly like the defect. `beforeAll` asserts the derivation instead of
 * trusting it.
 */
const RELAY_PEER = '12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q'

/** How long a request is given to arrive at the stand-in. Generous: nothing here is timed. */
const ARRIVAL_MS = 20_000

/** One thing the stand-in was asked for. Bodies are kept — arm B reads the stages out of them. */
interface Asked {
  readonly method: string
  readonly path: string
  readonly body: string
}

/** What the stand-in answers on `/funnel`, switched per arm and nothing else about it moves. */
type StandInMode = 'refuses' | 'is-a-collector'

let standIn: Server
let standInOrigin: string
let standInLog: Asked[] = []
let upgrades: string[] = []
let mode: StandInMode = 'refuses'

let server: ViteDevServer
let baseUrl: string
let browser: Browser
let relayAddress: string
let derivedEndpoint: string

/** The deployed collector's own body shape, read live 2026-09-04 and reproduced here. */
function collectorBody(): string {
  const zeros = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, 0]))
  return JSON.stringify({
    entered: zeros,
    stalledAt: zeros,
    byStageHour: {},
    webrtcAttempts: {},
    webrtcOutcomes: {},
    population: 'opted-in-only',
    schemaDigest: FUNNEL_SCHEMA_DIGEST,
  })
}

function answer(request: IncomingMessage, response: ServerResponse, body: string): void {
  const path = request.url ?? '(no url)'
  standInLog.push({ method: request.method ?? '(no method)', path, body })
  if (mode === 'refuses') {
    // A self-hosted seed's answer on its websocket port: a refusal, and no CORS header, so a
    // browser cannot read it either. Both halves are what a real seed does.
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('bad request')
    return
  }
  if (request.method === 'GET') {
    // `Access-Control-Allow-Origin` is not decoration: the page is on the Vite origin and the
    // collector is on this one, so without it the probe cannot READ the body it was sent — and
    // the deployed Worker sends exactly this header on `GET /funnel` for the same reason.
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    response.end(collectorBody())
    return
  }
  response.writeHead(204, { 'access-control-allow-origin': '*' })
  response.end()
}

beforeAll(async () => {
  standIn = createHttpServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      answer(request, response, Buffer.concat(chunks).toString('utf8'))
    })
  })
  // A websocket upgrade never reaches the request handler — node destroys it when nothing
  // listens — so it is logged separately rather than silently. The page WILL attempt one:
  // the address below is handed to it as a relay, and failing to dial it is expected.
  standIn.on('upgrade', (request, socket) => {
    upgrades.push(request.url ?? '(no url)')
    socket.destroy()
  })
  await new Promise<void>((resolve) => standIn.listen(0, HOST, resolve))
  const bound = standIn.address()
  if (bound === null || typeof bound === 'string') throw new Error('the stand-in bound no port')
  const port = (bound as AddressInfo).port
  standInOrigin = `http://${HOST}:${String(port)}`
  relayAddress = `/ip4/${HOST}/tcp/${String(port)}/ws/p2p/${RELAY_PEER}`

  // THE FLOOR under both arms. If the derivation answers null the page probes nothing, posts
  // nothing, and arm A passes while measuring an address that never named a collector.
  const derived = funnelEndpointFromRelay(relayAddress)
  expect(
    derived,
    `the stand-in's address ${relayAddress} derives no collector origin, so neither arm below ` +
      'is about a funnel at all',
  ).toBe(`${standInOrigin}/funnel`)
  derivedEndpoint = derived as string

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    cacheDir: fixtureViteCacheDir(ROOT),
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
}, 180_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await new Promise<void>((resolve) => {
    standIn?.close(() => resolve())
  })
}, 120_000)

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until the log satisfies a predicate, or the deadline passes. Never throws on timeout. */
async function settle(predicate: () => boolean, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs
  while (Date.now() < until && !predicate()) await sleep(100)
}

/**
 * The probe's own requests, and nothing else.
 *
 * **Narrowed to `/funnel` after the first red, which is a finding rather than a convenience.**
 * The page already polls `<relay origin>/self` — that is `kill-switch.ts`, reading the
 * admission field off the node it bootstrapped through — so this origin receives HTTP from
 * this page whether or not a funnel exists. A filter on the method alone would have counted
 * that poll and made the probe's cost look like two requests instead of one.
 */
const probes = (): Asked[] => standInLog.filter((one) => one.method === 'GET' && one.path === '/funnel')
const posts = (): Asked[] => standInLog.filter((one) => one.method === 'POST')

/** The whole log on one line, so a red reads as what arrived rather than as a boolean. */
function render(): string {
  const entries = standInLog.map((one) => `${one.method} ${one.path}`).join(', ')
  return `[${entries === '' ? 'nothing arrived' : entries}] upgrades=${String(upgrades.length)}`
}

/**
 * What the page's own reporter says about itself.
 *
 * Reached by importing the module URL the page already loaded. `funnelFacts` is a module export
 * of `demo/main.ts` — the `signinFacts` route — so no `window.o2` surface grows for a fixture.
 */
async function funnelFactsOf(page: Page): Promise<{ active: boolean; furthest: string | null }> {
  // **A string expression rather than a function, and it is a correction rather than a style.**
  // Vitest transforms this file before Playwright stringifies the callback, and a dynamic
  // `import()` inside a `page.evaluate` arrow comes out as `__vite_ssr_dynamic_import__` —
  // which is defined in the runner and not in the browser. Observed here as
  // `ReferenceError: __vite_ssr_dynamic_import__ is not defined`, at the point where both arms
  // had already passed every assertion about the log. A string is handed to the page untouched.
  const expression = `import(${JSON.stringify(MAIN_MODULE)}).then((loaded) => loaded.funnelFacts())`
  return page.evaluate<{ active: boolean; furthest: string | null }>(expression)
}

/**
 * Drive one visit: consent, register, and fire `start` at the stand-in as its relay.
 *
 * `start` is deliberately **not awaited**. Its relay is an HTTP server that destroys the
 * upgrade, so the node never bootstraps and the call either throws late or hangs — while the
 * funnel work this file is about all happens in the first few statements of `start`, before any
 * node is built. Awaiting it would make every arm a timeout.
 */
async function visit(page: Page, blockstoreName: string): Promise<void> {
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddress)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor clicks.
  await page.evaluate(() => {
    window.o2.grantConsent()
  })
  // AUTH-06 — `window.o2.start` throws `SignedOutError` until somebody has opened an envelope.
  await registerHarnessTab(page)
  await page.evaluate(
    ([relay, store]) => {
      void window.o2.start({ relayAddrs: [relay as string], blockstoreName: store as string }).catch(() => {
        // Expected: the relay is an HTTP server. The funnel decision has already been made.
      })
    },
    [relayAddress, blockstoreName],
  )
}

async function freshVisit(name: string): Promise<{ context: BrowserContext; page: Page }> {
  // A CONTEXT rather than a page: its own IndexedDB, so each arm registers rather than
  // finding the other arm's identity and taking the login shape.
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (error) => process.stderr.write(`[${name}] page error: ${error.message}\n`))
  return { context, page }
}

describe('RUN-07 — a derived collector that refuses is never sent a report', () => {
  it('posts nothing to a stand-in that answers 400, and says the funnel is inert', async () => {
    standInLog = []
    upgrades = []
    mode = 'refuses'
    const { context, page } = await freshVisit('arm-a')
    try {
      await visit(page, 'o2-funnel-probe-refused')
      // Wait for the probe to arrive and then keep waiting, because the failure this case is
      // about is a POST that arrives LATER than the probe would have.
      await settle(() => probes().length > 0, ARRIVAL_MS)
      await sleep(2_000)

      const posted = posts()
      expect(
        posted.length,
        `RUN-07: the page posted ${String(posted.length)} report(s) to a collector that ` +
          `answered 400 on every path. The derived origin is a self-hosted seed's websocket ` +
          `port, not a collector, and a report sent there is a report lost silently — ${render()}`,
      ).toBe(0)
      expect(
        probes().length,
        `RUN-07: the derived origin was not probed exactly once before being targeted — ${render()}`,
      ).toBe(1)

      const facts = await funnelFactsOf(page)
      // The control ON the instrument: a second module instance would say 'page-load'.
      expect(
        facts.furthest,
        'the fixture read a different module instance from the one the page is running, so ' +
          'the `active` reading below is an artefact of a fresh reporter rather than a ' +
          'measurement of this visit',
      ).toBe('consent')
      expect(
        facts.active,
        'RUN-07: the reporter reports itself ACTIVE against a collector that refused. That is ' +
          'the defect this plan closes — a funnel that looks configured and collects nothing, ' +
          'so a staged go/no-go reads zeros it cannot interpret',
      ).toBe(false)
    } finally {
      await context.close().catch(() => {})
    }
  }, 180_000)
})

describe('RUN-07 — the positive control, which is what makes the zero above a measurement', () => {
  it('probes and then posts its stages to a stand-in answering a funnel-shaped body', async () => {
    standInLog = []
    upgrades = []
    mode = 'is-a-collector'
    const { context, page } = await freshVisit('arm-b')
    try {
      await visit(page, 'o2-funnel-probe-collector')
      await settle(() => posts().length >= 2, ARRIVAL_MS)

      expect(
        probes().length,
        `RUN-07 control: the collector was not probed exactly once — ${render()}`,
      ).toBe(1)
      // Order, not just presence: the probe has to precede the reports, or the port was
      // installed on something other than the probe's answer. Read as indices into the one
      // log, so the kill switch's own `/self` poll can land anywhere without moving it.
      const probedAt = standInLog.findIndex((one) => one.method === 'GET' && one.path === '/funnel')
      const firstPostAt = standInLog.findIndex((one) => one.method === 'POST')
      expect(
        probedAt >= 0 && firstPostAt > probedAt,
        `RUN-07 control: the first report did not follow the probe — probe at ${String(probedAt)}, ` +
          `first report at ${String(firstPostAt)} — ${render()}`,
      ).toBe(true)

      const posted = posts()
      expect(
        posted.length,
        `RUN-07 control: the page probed a real collector and posted ${String(posted.length)} ` +
          `report(s). Arm A's zero is a property of the instrument unless this is at least two ` +
          `— ${render()}`,
      ).toBeGreaterThanOrEqual(2)
      const stages = posted.map((one) => (JSON.parse(one.body) as { stage?: unknown }).stage)
      for (const stage of stages) {
        expect(
          FUNNEL_STAGES.includes(stage as (typeof FUNNEL_STAGES)[number]),
          `RUN-07 control: a report named the stage ${JSON.stringify(stage)}, which is not one ` +
            'of the six',
        ).toBe(true)
      }
      // The held stages, in composition order and carrying the hour they happened — the 2026-09-03
      // repair, which is what makes an asynchronous probe safe to await at all.
      expect(stages.slice(0, 2)).toEqual(['page-load', 'consent'])

      const facts = await funnelFactsOf(page)
      expect(facts.furthest, 'the fixture read a different module instance').toBe('consent')
      expect(
        facts.active,
        `RUN-07 control: the collector answered as one and no send port was installed — ${render()}`,
      ).toBe(true)

      // eslint-disable-next-line no-console
      console.log(`[funnel-probe] derived ${derivedEndpoint}; arm B log ${render()}`)
    } finally {
      await context.close().catch(() => {})
    }
  }, 180_000)
})
