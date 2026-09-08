import { createServer as createHttpServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KERNEL_RECORD, KERNEL_TRUST_ANCHOR, kernelBytes } from '@o2/demo'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { signInDemoTab } from './e2e-signin.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * The visible switch, read on a node **nobody pressed Start for** — AUTH-06, plan `42-06`.
 *
 * ## What this adds over the two files it borrows every reading from
 *
 * BROW-07 and BROW-08 are closed, and this file does not re-mint either of them. A later
 * reader should not tick or untick a requirement row from here.
 *
 * `computing-indicator.e2e.test.ts` reads the title decoration from outside the page, in three
 * engines, with a second page brought to the front — the arrangement
 * `background-tab.e2e.test.ts:16-42` records as the one that actually hides the first, because
 * Chromium under automation never reports a page as hidden. `hard-stop.e2e.test.ts` reads Stop
 * as a hard interrupt of the `Worker.terminate()` class, with CPU measured falling to zero.
 * Both of them drive a node that a `#join` press started.
 *
 * **Since `42-04` a node can exist that nobody pressed anything for.** The owner ruled that a
 * logged-in visitor has a node already running, so `revealMain` starts one on unlock wherever
 * relay discovery found an address. That is a path which did not exist when BROW-07 and
 * BROW-08 were closed, and this file is those same requirements read on it. The readings are
 * copied from the two files above rather than invented; what is new is the trigger.
 *
 * The owner's second follow-up asked for *"a visible switch — the panel always shows it is
 * running, and one click stops it."* Read before building, all three parts were already in the
 * tree and already `[x]`: `document.title` (`packages/browser/src/computing-indicator.ts`),
 * `#bar` with `#bar-what` and `#bar-stats` (`demo/index.html:1806-1813`), and `#stop`. So
 * nothing here is built; it is wired to the new trigger and read.
 *
 * ## The one place this file corrects the plan, and it is measured rather than argued
 *
 * The plan says to wait until `window.o2.activity()` is non-null and then read the title. That
 * is not enough and `computing-indicator.e2e.test.ts` is where the reason is already written:
 * a **started but idle** tab carries the page's own title, deliberately, because an indicator
 * that said *computing* from the moment a node existed would say nothing about whether work is
 * in flight. So this file starts the node, asserts the idle title as its own reading, and only
 * then dispatches work — which is the same order that file uses.
 *
 * ## The bar's absence, stated exactly rather than repeated
 *
 * `demo/index.html:1801-1802` says the bar's absence copy is *"the element not being there —
 * `activity() === null` removes it"*, and the catalogue records `absenceMode:
 * 'element-removed'`. What the code does is set `hidden` on it (`renderBar`, `index.html:2105`),
 * so the element survives in the document and stops being visible. The assertion below reads
 * **visibility**, which is what a visitor has and what `demo-regions.e2e.test.ts` measures
 * (`barVisible: bar !== null && !bar.hidden`). Asserting a removal that does not happen would
 * be a false reading whichever way it went.
 *
 * ## Why this fixture stands up a relay AND a second HTTP server
 *
 * A relay, because every reading here is about a node that actually came up, and `revealMain`
 * starts nothing when discovery finds no address — which is exactly why
 * `artifact-fetch-gate.e2e.test.ts` still ends in `node not started` after `42-06` swept it.
 *
 * A second HTTP server on its own port, because the last case re-reads BROW-06 at the network:
 * not *"the tab did not ask for anything suspicious"* but *"nobody was asked for the
 * artifact"*. That is `artifact-fetch-gate.e2e.test.ts`'s instrument and its reason, borrowed
 * whole. The page-side request list is the corroboration; the server's own log is the reading.
 *
 * ## One engine, and the reason it is not three
 *
 * `computing-indicator.e2e.test.ts` runs three because criterion 2 of Phase 35 names them in
 * its own words. Nothing in `42-06` names an engine: what is new here is a **trigger**, and a
 * trigger is page logic rather than engine behaviour. Running three would triple a fixture
 * that stands up a relay, a Vite server, a gateway and two browser pages, for coverage the
 * file it borrows from already has.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** The artifact the gateway serves, and the CID the page will ask for it under. */
const MODULE_CID = KERNEL_RECORD.cid.toString()

/**
 * The decoration and the page's own title, written out rather than imported.
 *
 * `computing-indicator.e2e.test.ts`'s reason, unchanged: importing the constant would assert
 * it against itself, and a literal is the independent side of the comparison.
 */
const COMPUTING_PREFIX = '● Computing — '
const BASE_TITLE = 'o2.services — node'

/** `computing-indicator.e2e.test.ts`'s workload — more cubes, so the busy state lasts. */
const N = 204
const CUBES = 64

/** How long a title change is given, either way. */
const TITLE_DEADLINE_MS = 60_000
/** How long a start is given: a relay reservation and a WebRTC listen address. */
const START_MS = 120_000

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let context: BrowserContext
let page: Page
let front: Page

/** Every path the gateway server was asked for, in order. */
let gatewayLog: string[] = []
let gateway: Server
let gatewayOrigin: string

/** Everything the journey below observed, in the order it was observed. */
interface Journey {
  /** How many times `#join` was pressed in this whole case. The answer must be zero. */
  readonly joinClicksBeforeStop: number
  readonly startedAs: string
  readonly idleTitle: string
  readonly barVisibleWhileRunning: boolean
  readonly barWhat: string
  readonly toneWhileRunning: string
  readonly toneWhenSettled: string
  readonly busyTitle: string
  readonly frontTitleWhileBusy: string
  readonly titleAfterStop: string
  readonly barVisibleAfterStop: boolean
  readonly activityAfterStop: unknown
  readonly restartedAs: string
  /** The stale-consent re-read, after the identity is sealed and the consent is revoked. */
  readonly gateVisibleAfterRevoke: boolean
  readonly signinVisibleAfterRevoke: boolean
  readonly mainVisibleAfterRevoke: boolean
  readonly gatewayLogAfterRevoke: readonly string[]
  readonly pageSideGatewayRequests: readonly string[]
  readonly refusalAfterRevoke: string
  readonly threwAfterRevoke: string | null
}

let journey: Journey

/** Poll `page.title()` from the harness — `computing-indicator.e2e.test.ts`'s reader. */
async function waitForTitle(
  target: Page,
  wanted: (title: string) => boolean,
  deadlineMs: number,
): Promise<string> {
  const deadline = Date.now() + deadlineMs
  let last = await target.title()
  while (!wanted(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await target.title()
  }
  return last
}

beforeAll(async () => {
  // A dumb static gateway: one artifact, `application/wasm`, and a log.
  // `artifact-fetch-gate.e2e.test.ts`'s, including the CORS header and its stated reason —
  // a refusal after the request left is on the wrong side of the line being measured.
  gateway = createHttpServer((request, response) => {
    gatewayLog.push(request.url ?? '(no url)')
    if (request.url === `/${MODULE_CID}`) {
      response.writeHead(200, {
        'content-type': 'application/wasm',
        'access-control-allow-origin': '*',
      })
      response.end(Buffer.from(kernelBytes))
      return
    }
    response.writeHead(404, { 'access-control-allow-origin': '*' })
    response.end('no such artifact')
  })
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve))
  const gatewayAddress = gateway.address()
  if (gatewayAddress === null || typeof gatewayAddress === 'string') {
    throw new Error('the gateway server bound no port')
  }
  gatewayOrigin = `http://127.0.0.1:${String((gatewayAddress as AddressInfo).port)}`

  // DET-03: this node relays and executes nothing. The demo's own committed key, which is
  // what a visitor's tab pins with no flags.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 8,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  const dialable = relay.browserDialableAddrs[0]
  if (dialable === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = dialable

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
  // One context, two pages: separate contexts are separate windows and both stay visible.
  context = await browser.newContext()
  page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[autostarted] page error: ${error.message}\n`)
  })

  // **The `#join` counter, installed before any of the page's own script runs.** *"No `#join`
  // click occurred"* is the whole premise of this file, and a premise asserted by the absence
  // of a line in a spec is asserted by nothing — somebody adds the line back and every case
  // still passes while measuring the old path. A capturing listener on `document` sees a
  // press whether the harness made it or the page's own code did.
  await page.addInitScript(() => {
    const counted = window as unknown as Record<string, unknown>
    counted['__o2JoinClicks'] = 0
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target
        if (target instanceof Element && target.id === 'join') {
          counted['__o2JoinClicks'] = (counted['__o2JoinClicks'] as number) + 1
        }
      },
      true,
    )
  })

  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))

  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

  // ---- the two acts a visitor takes, and there is no third one -----------------------
  //
  // BROW-01 has no test-only bypass: the gate is answered by pressing the control a visitor
  // presses. AUTH-06: the passphrase is typed into the page's own field and its own button is
  // pressed. Nothing else is pressed in this whole file until `#stop`.
  await page.click('#allow')
  await signInDemoTab(page)

  // The node nobody started. `activity()` answers `null` while `node` is null and never
  // throws, so waiting on it is a reading rather than a swallowed exception —
  // `visitor-enrolment.e2e.test.ts#untilNodeRunning`'s measured reason.
  await page.waitForFunction(() => window.o2.activity() !== null, null, { timeout: START_MS })
  const startedAs = await page.evaluate(() => window.o2.addresses().peerId)
  const joinClicksBeforeStop = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__o2JoinClicks'] as number,
  )

  // Started and idle. Still the page's own title — the reading that stops the indicator
  // being a constant. `computing-indicator.e2e.test.ts` states it; this is it on the
  // auto-start path.
  const idleTitle = await page.title()

  // Taken at the instant a node EXISTS, which is deliberately earlier than the instant the
  // join handler finishes: `joinNow` goes on waiting for a WebRTC address afterwards, and
  // `demo-viewport.e2e.test.ts` records that distinction in the same words — *"the bar
  // appears because a node EXISTS, not because the join handler finished"*. Measured here on
  // the first run of this file: `#state` read `working` at this moment, not `live`.
  const running = await page.evaluate(() => ({
    barVisible: (() => {
      const bar = document.getElementById('bar')
      return bar !== null && !bar.hidden
    })(),
    barWhat: (document.getElementById('bar-what')?.textContent ?? '').trim(),
    tone: document.getElementById('state')?.dataset['tone'] ?? '(none)',
  }))
  // And the tone once the join has finished settling — a SECOND reading rather than a
  // relaxation of the first. The header must arrive at `live`; when it does is a different
  // question from when the bar appears, and reading them at one moment would have made the
  // earlier one wait on a relay round trip it has nothing to do with.
  await page.waitForFunction(
    () => document.getElementById('state')?.dataset['tone'] === 'live',
    null,
    { timeout: START_MS },
  )
  const toneWhenSettled = await page.evaluate(
    () => document.getElementById('state')?.dataset['tone'] ?? '(none)',
  )

  // The second page, brought to the front. From here the first page is not the page this
  // context is showing, which is the state the criterion is about.
  front = await context.newPage()
  await front.goto(`${baseUrl}${PAGE}`)
  await front.bringToFront()

  // Dispatched WITHOUT awaiting: the promise is held here while the page goes on running, so
  // the title reading below is taken *during* the work rather than after it.
  const run = page.evaluate(
    async ([n, cubes]) =>
      window.o2.runColouring({
        n: n as number,
        cubes: cubes as number,
        redundancy: 1,
        peerIds: [],
      }),
    [N, CUBES],
  )
  const busyTitle = await waitForTitle(
    page,
    (title) => title.startsWith(COMPUTING_PREFIX),
    TITLE_DEADLINE_MS,
  )
  const frontTitleWhileBusy = await front.title()
  await run

  // ---- one click stops it -------------------------------------------------------------
  await page.bringToFront()
  await page.click('#stop')
  await page.waitForFunction(() => window.o2.activity() === null, null, { timeout: 60_000 })
  const titleAfterStop = await waitForTitle(
    page,
    (title) => !title.startsWith(COMPUTING_PREFIX),
    TITLE_DEADLINE_MS,
  )
  const afterStop = await page.evaluate(() => ({
    barVisible: (() => {
      const bar = document.getElementById('bar')
      return bar !== null && !bar.hidden
    })(),
    activity: window.o2.activity(),
  }))

  // ---- stopping did not sign the visitor out ------------------------------------------
  //
  // `#stop` re-enables `#join` (`index.html:2431`), so starting again is the visitor's own
  // control and needs no second passphrase: the one they typed is held for this visit. This
  // is the only `#join` press in the file, and it is after the readings that depend on there
  // being none.
  await page.waitForFunction(
    () => document.getElementById('join')?.hasAttribute('disabled') === false,
    null,
    { timeout: 60_000 },
  )
  await page.click('#join')
  await page.waitForFunction(() => window.o2.activity() !== null, null, { timeout: START_MS })
  const restartedAs = await page.evaluate(() => window.o2.addresses().peerId)

  // ---- the stale-consent ordering, at the network -------------------------------------
  //
  // The one path `42-04` created that could plausibly have bypassed BROW-01/BROW-06: a
  // returning visitor whose browser holds a sealed identity, whose consent record has gone.
  // The gate must come back and must come back FIRST — before the passphrase field, not
  // beside it — and no task byte may be requested while it stands.
  await page.evaluate(async () => {
    await window.o2.stop()
    await window.o2.revokeConsent()
  })
  gatewayLog = []
  requested.length = 0
  await page.reload()
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // **Waited on "the entry surface has rendered", NOT on "the gate is up", and the difference
  // is what makes the case below able to fail by name.** A wait for `#gate` un-hidden is an
  // assertion wearing a timeout: a page that answered this wrong would hang here and every
  // case in the file would report `beforeAll failed` with a `TimeoutError` saying nothing
  // about consent. So the hook waits for whichever of the two surfaces the page chose, records
  // it, and the assertions carry their own sentences. Read against the plant in `42-06`, which
  // is exactly the page that answers it wrong.
  await page.waitForFunction(
    () =>
      document.getElementById('gate')?.hasAttribute('hidden') === false ||
      document.getElementById('signin')?.hasAttribute('hidden') === false ||
      document.getElementById('main')?.hasAttribute('hidden') === false,
    null,
    { timeout: 60_000 },
  )
  const revoked = {
    gate: await page.isVisible('#gate'),
    signin: await page.isVisible('#signin'),
    main: await page.isVisible('#main'),
  }
  const attempt = await page.evaluate(
    async ([origin, cid]) => {
      try {
        const report = await window.o2.fetchModule({
          gatewayBase: `${origin!}/`,
          moduleCid: cid!,
          recordCid: cid!,
          recordName: 'kernel',
        })
        return { thrown: null, reason: report.ok ? '(the fetch reported ok)' : report.reason }
      } catch (cause) {
        return { thrown: String(cause), reason: '' }
      }
    },
    [gatewayOrigin, MODULE_CID],
  )
  // Long enough that a request in flight when `fetchModule` returned would have arrived.
  await page.waitForTimeout(1_000)

  journey = {
    joinClicksBeforeStop,
    startedAs,
    idleTitle,
    barVisibleWhileRunning: running.barVisible,
    barWhat: running.barWhat,
    toneWhileRunning: running.tone,
    toneWhenSettled,
    busyTitle,
    frontTitleWhileBusy,
    titleAfterStop,
    barVisibleAfterStop: afterStop.barVisible,
    activityAfterStop: afterStop.activity,
    restartedAs,
    gateVisibleAfterRevoke: revoked.gate,
    signinVisibleAfterRevoke: revoked.signin,
    mainVisibleAfterRevoke: revoked.main,
    gatewayLogAfterRevoke: [...gatewayLog],
    pageSideGatewayRequests: requested.filter((url) => url.startsWith(gatewayOrigin)),
    refusalAfterRevoke: attempt.reason ?? '',
    threwAfterRevoke: attempt.thrown,
  }
}, 900_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await new Promise<void>((resolve) => {
    gateway?.close(() => resolve())
  })
}, 180_000)

describe('BROW-07 and BROW-08, read on a node nobody pressed Start for', () => {
  it('has a node running with no press of #join anywhere in the case', () => {
    expect(
      journey.joinClicksBeforeStop,
      'the node this file reads was started by a press of #join, so every reading below is ' +
        'about the path BROW-07 and BROW-08 were already closed on rather than the new one',
    ).toBe(0)
    expect(
      journey.startedAs,
      'unlocking produced no node, so there is nothing here that nobody started',
    ).toMatch(/^12D3Koo/)
  })

  it('says so in the tab strip while a second page is in front, and not before there is work', () => {
    // The idle reading first, because it is what makes the busy one mean something.
    expect(
      journey.idleTitle,
      'a started-but-idle tab already claimed to be computing, so the indicator says nothing ' +
        'about whether work is in flight',
    ).toBe(BASE_TITLE)
    expect(
      journey.busyTitle,
      `with work in flight and a second page in front, the tab strip read "${journey.busyTitle}". ` +
        'A visitor looking at another tab has the title and the favicon and nothing else.',
    ).toBe(`${COMPUTING_PREFIX}${BASE_TITLE}`)
    // The other page really is the front one, asserted rather than assumed — if
    // `bringToFront` had done nothing, the reading above would be about a focused tab.
    expect(journey.frontTitleWhileBusy).toBe(BASE_TITLE)
  })

  it('shows the panel is running, on three readings rather than one', () => {
    // Three, because a bar that rendered while `activity()` was `null` would satisfy any
    // single one of them and would be exactly the always-visible bar this project already
    // shipped once and had reported from a phone.
    expect(journey.barVisibleWhileRunning, '#bar is not on screen while a node is running').toBe(
      true,
    )
    expect(
      journey.barWhat,
      '#bar-what is empty, so the panel says a node exists without saying what it is doing',
    ).not.toBe('')
    // The header, once the join has settled. The tone at the instant the bar appeared is
    // recorded rather than asserted, because `joinNow` is still waiting for a WebRTC address
    // there — it read `working` on this file's first run, and asserting `live` at that moment
    // would have been asserting that a relay round trip had already finished.
    expect(
      journey.toneWhenSettled,
      'the header does not report a live node while one is running, so the panel and the ' +
        `state are describing different tabs (it read "${journey.toneWhileRunning}" at the ` +
        'instant the bar appeared, which is a different and earlier moment)',
    ).toBe('live')
    // And the bar was up BEFORE that — the property `demo-viewport.e2e.test.ts` states: the
    // bar tracks the node's existence, not the join handler's return.
    expect(
      ['working', 'live'],
      `#state read "${journey.toneWhileRunning}" at the moment a node first existed, which is ` +
        'neither of the two tones a starting node can be in',
    ).toContain(journey.toneWhileRunning)
  })

  it('stops on one click, and says so in all three places', () => {
    expect(journey.activityAfterStop, 'Stop left a node running').toBeNull()
    expect(
      journey.titleAfterStop,
      'the tab strip still claims this machine is computing after Stop',
    ).toBe(BASE_TITLE)
    expect(
      journey.barVisibleAfterStop,
      '#bar is still on screen with no node — its absence copy IS the element not being ' +
        'shown, so a visible bar over a stopped node is a reading that is false',
    ).toBe(false)
  })

  it('is the same node when it is started again, because the visitor is still signed in', () => {
    // Before `42-04` this could not hold: a tab minted a fresh key per start, so a stop and a
    // start were two nodes. The sealed identity is what makes *"How do I stop it?"* answerable
    // without also meaning *"and you become somebody else"*.
    expect(
      journey.restartedAs,
      `the tab came back as a different node across Stop and Start: ${journey.startedAs} then ` +
        `${journey.restartedAs}. Stopping is not signing out, and the passphrase is still held.`,
    ).toBe(journey.startedAs)
  })
})

describe('BROW-01/BROW-06 on the auto-start path — the gate comes back FIRST', () => {
  it('puts the gate in front of the passphrase field when the stored consent has gone', () => {
    expect(
      journey.gateVisibleAfterRevoke,
      'a returning visitor whose consent record has gone was not asked again. This is the one ' +
        'path 42-04 created that could bypass BROW-01: a browser holding a sealed identity ' +
        'whose owner never answered the disclosure now in force.',
    ).toBe(true)
    expect(
      journey.signinVisibleAfterRevoke,
      'the passphrase field is offered beside the gate rather than after it — and unlocking ' +
        'starts a node, so offering the two together offers a start under an unanswered ' +
        'disclosure',
    ).toBe(false)
    expect(journey.mainVisibleAfterRevoke, 'the workload surfaces opened with the gate up').toBe(
      false,
    )
  })

  it('asks the gateway for nothing at all while the gate stands, and says consent is why', () => {
    expect(
      journey.gatewayLogAfterRevoke,
      `with the consent revoked, the gateway server was asked for ` +
        `${journey.gatewayLogAfterRevoke.join(', ')}. A reviewer watching network traffic reads ` +
        'a fetch as preparation-to-run; the gate has to sit in front of the request.',
    ).toEqual([])
    // The corroborating reading, from the page side.
    expect(journey.pageSideGatewayRequests).toEqual([])
    // And the refusal is about consent — not about a node that has not started, which would
    // mean the zero above is being produced by the wrong mechanism.
    expect(
      journey.threwAfterRevoke,
      'the fetch threw instead of refusing, so the empty log says nothing about a consent gate',
    ).toBeNull()
    expect(journey.refusalAfterRevoke).toContain('before you have agreed')
    expect(journey.refusalAfterRevoke).not.toContain('node not started')
  })
})
