import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DIGIT } from '../../browser/src/demo-regions.ts'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'

/**
 * RUN-06's automated half — the page notices it is inside somebody else's browser.
 *
 * ## The one thing this file exists to do, and the direction it drives to do it
 *
 * RUN-06 asks that Telegram's in-app WebView be detected and the visitor offered an
 * "open in your own browser" notice. The requirement's own verification is a hand check on
 * two real devices, and Phase 38's criterion 1 says why in a sentence that rules out the
 * obvious automated substitute: *the point of the check is the engine, not the string*. A
 * spec that set `userAgent` to something Telegram-shaped and then watched a notice appear
 * would prove that a string check works, which is precisely the evidence criterion 1
 * refuses.
 *
 * So **case A drives it the other way round**: `context.addInitScript` defines a host bridge
 * object on the page before any of the page's own code runs, and the context is left with
 * headless Chromium's own stock desktop user-agent — `Macintosh; Intel Mac OS X`, naming no
 * phone and no messaging application. A detector that reads only `navigator.userAgent`
 * cannot pass this case. That is the whole design of the file.
 *
 * **Case B is the mirror and it is deliberately not RUN-06's evidence.** A Telegram-shaped
 * user-agent with no injected object *does* raise the notice — an offer costs a visitor a
 * dismiss button and nothing else — but the verdict it produces must record
 * `engineCorroborated: false`. Its title carries no `RUN-06`, and that is load-bearing
 * rather than tidy: `acceptance-traceability.node.test.ts` traces a satisfied ledger row to
 * a test whose *title* names it, so a case titled `RUN-06` that a spoofed string can satisfy
 * would launder criterion 1's refusal into the ledger.
 *
 * ## What this file does NOT claim
 *
 * **It does not close RUN-06.** Criterion 1's evidence is the owner's two real devices in
 * Plan 38-04 — a real recruitment link, opened from a real Telegram message, on iOS and on
 * Android. Every row of `CANDIDATE_SIGNALS` is declared `candidate` confidence because no
 * authoritative current source was found for Telegram's client behaviour, and this spec
 * measures that the *mechanism* works on the signals as declared. Whether those are the
 * signals Telegram actually emits is a device reading, not a Playwright one.
 *
 * ## Why there is no consent walk here
 *
 * Every other e2e fixture in this directory clicks `#allow` and signs in, because the
 * surface it is about lives behind `#main`. The notice does not: it is painted at page
 * start, before the gate, and it is deliberately outside `#main` (see
 * `<catalogue_decision>` in `38-01-PLAN.md`, and the jurisdiction case at the foot of this
 * file which turns that paragraph into a check). Waiting for `window.o2` is enough — the
 * detection runs at `demo/main.ts` module scope, before that assignment, so a page that has
 * published `window.o2` has already settled its verdict.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * The bridge object case A injects, and why this name.
 *
 * `TelegramWebviewProxy` is the global Telegram's Android client is *reported* to define on
 * pages it opens. Reported, not measured: the phase's Research note records that Telegram's
 * current WebView behaviour *"was not found in any authoritative current source"*. What this
 * spec proves is that a host-injected object of that name raises the notice with no
 * user-agent change at all. Whether Telegram injects exactly this is Plan 38-04's reading.
 */
const BRIDGE_OBJECT = 'TelegramWebviewProxy'

/**
 * A Telegram-**shaped** Android string for case B. Shaped, not captured.
 *
 * Android rather than iOS on purpose. The `navigator.standalone absent` row fires only on an
 * iOS-shaped user-agent — on a desktop browser that property is absent as a matter of course
 * (measured: undefined in stock Chromium and stock Firefox), so absence there says nothing —
 * and an iOS-shaped string here would fire it and corroborate case B by accident. The point
 * of case B is that a string alone corroborates nothing, so the string must be one that
 * fires the user-agent row and no other.
 */
const TELEGRAM_SHAPED_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36 Telegram-Android/10.14.5'

/** What the page publishes for this harness to read, flattened to what crosses the bridge. */
interface EntryVerdictSnapshot {
  readonly embedded: boolean
  readonly engineCorroborated: boolean
  readonly fired: readonly string[]
}

let server: ViteDevServer
let browser: Browser
let baseUrl: string

let embeddedContext: BrowserContext
let embeddedPage: Page
/** Every request case A's page made, collected from before `goto` — case C's reading. */
const embeddedRequests: string[] = []

let spoofedContext: BrowserContext
let spoofedPage: Page

/** Read the page's published verdict, or `null` when it has published none. */
async function readVerdict(page: Page): Promise<EntryVerdictSnapshot | null> {
  return page.evaluate(() => {
    const raw = (window as unknown as Record<string, unknown>)['__o2EntryVerdict']
    if (raw === undefined || raw === null) return null
    const verdict = raw as {
      embedded: boolean
      engineCorroborated: boolean
      fired: readonly { name: string }[]
    }
    return {
      embedded: verdict.embedded,
      engineCorroborated: verdict.engineCorroborated,
      fired: verdict.fired.map((signal) => signal.name),
    }
  })
}

describe('the page notices it is inside a host application, by what the host injects', () => {
  beforeAll(async () => {
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

    // ── Case A's context. NO `userAgent` option: the whole claim is that this passes with
    //    headless Chromium's own stock desktop string, which no detector can mistake for a
    //    phone and which names no messaging application.
    embeddedContext = await browser.newContext()
    await embeddedContext.addInitScript(() => {
      // The host's injection, before any page script — which is what an embedding
      // application does and what `addInitScript` exists to reproduce. `postEvent` is the
      // method the reported bridge carries; nothing here calls it, and the detector must
      // not call it either.
      ;(window as unknown as Record<string, unknown>)['TelegramWebviewProxy'] = {
        postEvent: (): void => {},
      }
    })
    embeddedPage = await embeddedContext.newPage()
    embeddedPage.on('pageerror', (error) => {
      process.stderr.write(`[page error, embedded] ${error.message}\n`)
    })
    // Attached BEFORE `goto`, or the document request itself is missed and case C's floor
    // would be measuring a collector that started late rather than a page that loaded.
    embeddedPage.on('request', (request) => embeddedRequests.push(request.url()))

    await embeddedPage.goto(`${baseUrl}${PAGE}`)
    await embeddedPage.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
      timeout: 60_000,
    })
    // Long enough that a font, an icon set or a discovery fetch would have gone out — the
    // same window `built-bundle.e2e.test.ts` gives P10, for the same reason.
    await embeddedPage.waitForTimeout(1_500)

    // ── Case B's context. A string and nothing else.
    spoofedContext = await browser.newContext({ userAgent: TELEGRAM_SHAPED_AGENT })
    spoofedPage = await spoofedContext.newPage()
    spoofedPage.on('pageerror', (error) => {
      process.stderr.write(`[page error, spoofed] ${error.message}\n`)
    })
    await spoofedPage.goto(`${baseUrl}${PAGE}`)
    await spoofedPage.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
      timeout: 60_000,
    })
  }, 180_000)

  afterAll(async () => {
    await embeddedContext?.close().catch(() => {})
    await spoofedContext?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
  }, 60_000)

  it('RUN-06 — raises the notice for a host-injected bridge object with a stock desktop user-agent', async () => {
    // The string this case runs with, read from the page rather than assumed, so the claim
    // "no user-agent evidence was available" is a measurement and not a comment.
    const agent = await embeddedPage.evaluate(() => navigator.userAgent)
    expect(
      agent,
      `case A ran with a user-agent naming Telegram — "${agent}" — so a plain string check ` +
        'would satisfy it and the case would stop being the thing criterion 1 asks for',
    ).not.toMatch(/telegram/i)
    expect(
      agent,
      `case A ran with a mobile-shaped user-agent — "${agent}" — see above`,
    ).not.toMatch(/iPhone|iPad|iPod|Android/i)

    // Existence first, with its own message. A bare visibility wait would report a 30 s
    // TimeoutError as the failure, which says the notice did not appear and not why.
    const present = await embeddedPage.evaluate(
      () => document.getElementById('entry-notice') !== null,
    )
    expect(
      present,
      'the page carries no element with id "entry-notice", so a visitor inside a host ' +
        "application's browser is offered nothing",
    ).toBe(true)

    expect(
      await embeddedPage.isVisible('#entry-notice'),
      '#entry-notice exists and is not on screen — a notice nobody can see is not an offer',
    ).toBe(true)

    const signals = (await embeddedPage.textContent('#entry-notice-signals')) ?? ''
    expect(
      signals,
      `#entry-notice-signals reads "${signals}" and does not name ${BRIDGE_OBJECT} — the ` +
        'notice is on screen without saying what raised it',
    ).toContain(BRIDGE_OBJECT)

    const verdict = await readVerdict(embeddedPage)
    expect(verdict, 'the page published no window.__o2EntryVerdict').not.toBeNull()
    expect(verdict?.embedded).toBe(true)
    // The claim in one field: the evidence was an engine observable, not a string.
    expect(
      verdict?.engineCorroborated,
      'the notice was raised with no engine evidence, in a case whose user-agent names ' +
        'nothing — so either the verdict is misreporting its own grounds or the notice was ' +
        'raised by something this case did not arrange',
    ).toBe(true)
  }, 120_000)

  it('records a Telegram-shaped user-agent alone as string-only evidence, never as engine evidence', async () => {
    const agent = await spoofedPage.evaluate(() => navigator.userAgent)
    expect(agent, 'the user-agent override did not take, so this case tests nothing').toContain(
      'Telegram',
    )
    const injected = await spoofedPage.evaluate(
      () => (window as unknown as Record<string, unknown>)['TelegramWebviewProxy'] !== undefined,
    )
    expect(injected, 'case B has a bridge object, so it is case A with extra steps').toBe(false)

    const verdict = await readVerdict(spoofedPage)
    expect(verdict, 'the page published no window.__o2EntryVerdict').not.toBeNull()
    expect(
      verdict?.engineCorroborated,
      `a string alone was recorded as engine evidence (fired: ${JSON.stringify(verdict?.fired)}) — ` +
        'which is exactly the green criterion 1 refuses, and it would make the RUN-06 case ' +
        'above satisfiable by anyone who can set a header',
    ).toBe(false)
  }, 120_000)

  it('contacts nobody: every request case A made has the page’s own origin', async () => {
    const origin = new URL(baseUrl).origin
    const inProcess = /^(?:about|data|blob):/
    const foreign = embeddedRequests.filter((url) => {
      if (inProcess.test(url)) return false
      try {
        return new URL(url).origin !== origin
      } catch {
        // A URL this test cannot parse is a URL it cannot vouch for.
        return true
      }
    })
    expect(
      foreign,
      `the page contacted ${String(foreign.length)} foreign origin(s) while raising the ` +
        `notice — ${[...new Set(foreign.map((url) => new URL(url).origin))].join(', ')}. ` +
        'Detection reads in-page globals and must issue no request; T-38-03.',
    ).toEqual([])

    // The floor. An empty request list satisfies "no foreign origin" perfectly, so the
    // collection is also required to hold the page's own assets — the same anti-vacuity
    // shape `built-bundle.e2e.test.ts` P10 carries, and for the same reason.
    const own = embeddedRequests.filter((url) => url.startsWith(origin))
    expect(
      own.length,
      `the request collector saw ${String(embeddedRequests.length)} request(s) in total and ` +
        'none of them same-origin — the page did not load, so the clean result above is an ' +
        'artefact of the instrument rather than a property of the page',
    ).toBeGreaterThan(1)
  }, 120_000)

  /**
   * The catalogue's jurisdiction, asserted rather than argued.
   *
   * `38-01-PLAN.md`'s `<catalogue_decision>` rules that `demo-regions.ts` and UI-SPEC's tally
   * do not move for this notice, and it rules that on three properties: the section sits
   * outside `#main`, declares no `data-region`, and carries no digit. Each is checked here,
   * against the notice **while it is on screen** — a hidden section trivially satisfies all
   * three and would make this a paragraph with a green beside it.
   *
   * `DIGIT` is imported from the catalogue rather than written again, so there is one
   * definition of *digit on screen* in this repository and not two that can come to disagree.
   */
  it('stays outside the region catalogue\u2019s jurisdiction, on all three of the properties that keep it there', async () => {
    const notice = await embeddedPage.evaluate(() => {
      const section = document.getElementById('entry-notice')
      if (section === null) return null
      const main = document.getElementById('main')
      return {
        text: (section.textContent ?? '').trim(),
        regions: section.querySelectorAll('[data-region]').length,
        insideMain: main !== null && main.contains(section),
        visible: !section.hidden,
      }
    })

    expect(notice, 'there is no #entry-notice to have jurisdiction over').not.toBeNull()
    // The floor, and it is not decoration: 'holds no digit' and 'declares no region' are both
    // perfectly satisfied by an empty section, so a notice that rendered nothing would pass
    // all three properties below while offering the visitor nothing at all.
    expect(
      notice?.visible,
      'the notice is hidden in the case that raised it, so the three readings below are ' +
        'about a section nobody can see',
    ).toBe(true)
    expect(
      (notice?.text ?? '').length,
      `#entry-notice holds ${String((notice?.text ?? '').length)} characters of text — an ` +
        'empty section satisfies every property below and says nothing to a visitor',
    ).toBeGreaterThan(200)

    expect(
      DIGIT.test(notice?.text ?? ''),
      `#entry-notice puts a digit on screen — "${notice?.text ?? ''}". The section is ` +
        'digit-free so that it carries no figure, which is what keeps it outside the region ' +
        'catalogue; a digit here means REGIONS, UI_SPEC_TALLY and UI-SPEC sections 4 and 12 ' +
        'must move in the same commit as the markup',
    ).toBe(false)

    expect(
      notice?.regions,
      'a [data-region] appeared inside #entry-notice, which enumerates it into ' +
        "demo-regions.e2e.test.ts's P1a as an uncatalogued region of no surface",
    ).toBe(0)

    expect(
      notice?.insideMain,
      '#entry-notice moved inside #main, where P2\u2019s TreeWalker walks it for undeclared ' +
        'digits and where the notice has no business being — it is shown before consent',
    ).toBe(false)
  }, 120_000)
})
