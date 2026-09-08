import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DIGIT } from '../../browser/src/demo-regions.ts'
import { HIDDEN_GAP_SENTENCES } from '../../browser/src/hidden-gap.ts'
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

/**
 * The host injection, as one function three contexts share.
 *
 * Case A defines it inline and is left alone — it is the RUN-06 case and it reads better with
 * the host's act written where the claim is made. Everything below wants the same injection
 * for a different reason (to get the notice on screen so a readout inside it can be read), and
 * three more copies of it is three places for the bridge name to drift.
 */
const INJECT_BRIDGE = (): void => {
  ;(window as unknown as Record<string, unknown>)['TelegramWebviewProxy'] = {
    postEvent: (): void => {},
  }
}

/**
 * The visibility override, and **the probe that forced this spec onto it — measured, dated.**
 *
 * The plan asked for the operating system's own hidden state first: a second page in the same
 * context plus `bringToFront()` on it. That was probed before this arm was written, outside
 * this repository, against `about:blank` in a Chromium launched with the same flag the
 * fixtures use (2026-09-06):
 *
 * ```json
 * { "before": "visible",
 *   "during": { "state": "visible", "hidden": false, "ticks": 12, "seen": [] },
 *   "after":  { "state": "visible", "ticks": 14, "seen": [] } }
 * ```
 *
 * The first page stayed `visible` throughout, `document.hidden` stayed `false`, **not one
 * `visibilitychange` event fired**, and its interval delivered twelve ticks across three
 * seconds at a quarter-second period — the full rate. Headless Chromium does not background a
 * page for another page in the same context. That is the same reading Phase 35 already had a
 * design decision from — *"the computing indicator is unconditional on visibility state, the
 * only design an automated harness can read"* — arrived at again from the other direction.
 *
 * So this arm drives the **DOM event**, and the case that uses it is titled for the DOM event.
 * It defines `document.hidden` and `document.visibilityState` as own accessors, which shadow
 * the prototype's, and dispatches the event in the order a browser does: state first, event
 * second. **What it therefore does NOT measure is an operating system deciding to suspend a
 * tab.** That reading needs a real phone and it belongs to Plan 38-04. A case here titled as
 * though it had taken it would be exactly the laundering this phase exists to refuse.
 */
const DRIVE_VISIBILITY = (): void => {
  let driven = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => driven })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (driven ? 'hidden' : 'visible'),
  })
  ;(window as unknown as Record<string, unknown>)['__o2DriveHidden'] = (next: boolean): void => {
    driven = next
    document.dispatchEvent(new Event('visibilitychange'))
  }
}

/**
 * The diagnostics parameter, exactly as a link would carry it.
 *
 * The value is `on` and not `1`. A digit in a URL is harmless — the URL is never rendered —
 * but the section it opens is digit-free by rule, and a habit is what eventually puts one
 * there.
 */
const DIAGNOSTICS_QUERY = 'entry-diagnostics=on'

/**
 * How long the driven-hidden case leaves the page hidden.
 *
 * It has to clear the instrument's own floor, which is stated in `hidden-gap.ts` as a count of
 * due intervals rather than a duration — a dozen of them, about three seconds at the default
 * period. Four seconds clears it without pinning this spec to either number: if the period
 * changes, the floor moves with it and this stays on the right side.
 */
const DRIVEN_HIDDEN_MS = 4_000

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

/** A page that dismisses the notice, so the shared case-A page keeps its own state. */
let dismissContext: BrowserContext
let dismissPage: Page

/** A page whose `document.hidden` this spec drives. See {@link DRIVEN_HIDDEN_MS}. */
let gapContext: BrowserContext
let gapPage: Page

/** One context, two pages: the same browser with the parameter and without it. */
let diagnosticsContext: BrowserContext
let forcedPage: Page
let plainPage: Page

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

    // ── The dismissal case's own context. It has to be its own: the click collapses the
    //    notice, and case A's page is read by two later cases that need it whole — the
    //    jurisdiction case's 200-character floor would fail on shared state rather than on
    //    anything about the markup.
    dismissContext = await browser.newContext()
    await dismissContext.addInitScript(INJECT_BRIDGE)
    dismissPage = await dismissContext.newPage()
    dismissPage.on('pageerror', (error) => {
      process.stderr.write(`[page error, dismiss] ${error.message}\n`)
    })
    await dismissPage.goto(`${baseUrl}${PAGE}`)
    await dismissPage.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
      timeout: 60_000,
    })

    // ── The hidden-span case's context: the bridge, so the notice is on screen and the
    //    readout is read where a visitor would see it, plus the visibility override the
    //    probe below forced this spec onto.
    gapContext = await browser.newContext()
    await gapContext.addInitScript(INJECT_BRIDGE)
    await gapContext.addInitScript(DRIVE_VISIBILITY)
    gapPage = await gapContext.newPage()
    gapPage.on('pageerror', (error) => {
      process.stderr.write(`[page error, gap] ${error.message}\n`)
    })
    await gapPage.goto(`${baseUrl}${PAGE}`)
    await gapPage.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
      timeout: 60_000,
    })

    // ── Diagnostics: one context with NO bridge and no user-agent override, opened twice —
    //    once with the parameter and once without. Same browser, same page, one difference.
    diagnosticsContext = await browser.newContext()
    forcedPage = await diagnosticsContext.newPage()
    forcedPage.on('pageerror', (error) => {
      process.stderr.write(`[page error, diagnostics] ${error.message}\n`)
    })
    await forcedPage.goto(`${baseUrl}${PAGE}?${DIAGNOSTICS_QUERY}`)
    await forcedPage.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
      timeout: 60_000,
    })

    plainPage = await diagnosticsContext.newPage()
    plainPage.on('pageerror', (error) => {
      process.stderr.write(`[page error, plain] ${error.message}\n`)
    })
    await plainPage.goto(`${baseUrl}${PAGE}`)
    await plainPage.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
      timeout: 60_000,
    })
  }, 300_000)

  afterAll(async () => {
    await embeddedContext?.close().catch(() => {})
    await spoofedContext?.close().catch(() => {})
    await dismissContext?.close().catch(() => {})
    await gapContext?.close().catch(() => {})
    await diagnosticsContext?.close().catch(() => {})
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

  /**
   * Dismissal collapses the notice; it does not take the readout away with it.
   *
   * **This is the point of the readout, not a detail of it.** The observations criterion 2
   * needs are taken *after* the visitor has tapped continue-here-anyway — that is when the
   * page is left alone long enough to be backgrounded — so a readout that disappears with the
   * notice is an instrument that is gone exactly when it is wanted.
   *
   * The section is never removed from the DOM, and the two lines that carry evidence stay on
   * screen while the offer itself goes.
   */
  it('collapses to the readout when the visitor stays here, and never leaves the DOM', async () => {
    // The floor first. "The headline is not visible" is satisfied perfectly by a page where
    // the notice never appeared at all, so the reading below is only about dismissal if the
    // notice was up before the click.
    expect(
      await dismissPage.isVisible('#entry-notice-headline'),
      'the notice was not on screen before the click, so what follows measures a section ' +
        'that was never raised rather than the effect of dismissing one',
    ).toBe(true)

    await dismissPage.click('#entry-notice-dismiss')

    expect(
      await dismissPage.evaluate(() => document.getElementById('entry-notice') !== null),
      '#entry-notice was removed from the DOM by its own dismiss control — there is nothing ' +
        'left for the hidden-span readout to be written into',
    ).toBe(true)

    expect(
      await dismissPage.isVisible('#entry-notice-headline'),
      'the offer is still on screen after the visitor declined it',
    ).toBe(false)

    expect(
      await dismissPage.isVisible('#entry-notice-signals'),
      'the signal names went away with the offer. They are the answer to which candidate ' +
        'fired on this device, and Plan 38-04 reads them after the visitor has continued',
    ).toBe(true)

    expect(
      await dismissPage.isVisible('#entry-notice-liveness'),
      'the hidden-span readout went away with the offer, which is the one moment it is ' +
        'wanted: criterion 2 is observed after continue-here-anyway, not before it',
    ).toBe(true)
  }, 120_000)

  /**
   * The readout moves off its opening sentence once a visibility change has been driven.
   *
   * **What this case drives is the DOM event, and its title says so.** `DRIVE_VISIBILITY`
   * carries the probe that forced it onto that arm: under this headless Chromium a second page
   * plus `bringToFront()` leaves the first page `visible`, fires no event, and does not slow
   * its timers. An operating system deciding to suspend a tab is not available here. That
   * reading comes from the owner's two phones in Plan 38-04.
   *
   * **It asserts a change and never a particular sentence.** Which of the three post-hide
   * sentences this harness produces is a fact about headless Chromium — recorded in
   * `38-02-SUMMARY.md`, where a fact about the harness belongs — and pinning it here would be
   * an absolute reading of this machine of exactly the kind `CLAUDE.md` § Measurement refuses.
   * The precondition below is what gives the assertion its teeth: the opening sentence is
   * checked to be on screen *before* the span, so "it changed" is a change from a known state.
   */
  it('moves the hidden-span readout off its opening sentence when a visibilitychange is driven', async () => {
    const opening = ((await gapPage.textContent('#entry-notice-liveness')) ?? '').trim()
    expect(
      opening,
      'the readout did not open on the sentence that says nothing has been observed, so a ' +
        'change away from it below would not be a change from a known state',
    ).toBe(HIDDEN_GAP_SENTENCES['not-yet'])

    await gapPage.evaluate(() => {
      const drive = (window as unknown as Record<string, (next: boolean) => void>)[
        '__o2DriveHidden'
      ]
      drive?.(true)
    })

    // The floor under the fallback arm. If the override had not taken, the page would never
    // have been hidden at all and the reading below would be measuring the harness.
    expect(
      await gapPage.evaluate(() => document.hidden),
      'the injected override did not take, so this page was never hidden by any definition ' +
        'and nothing after this point is about the instrument',
    ).toBe(true)

    await gapPage.waitForTimeout(DRIVEN_HIDDEN_MS)

    await gapPage.evaluate(() => {
      const drive = (window as unknown as Record<string, (next: boolean) => void>)[
        '__o2DriveHidden'
      ]
      drive?.(false)
    })

    const settled = ((await gapPage.textContent('#entry-notice-liveness')) ?? '').trim()
    expect(
      settled,
      `#entry-notice-liveness still reads "${settled}" after a hidden span longer than the ` +
        "instrument's own floor — the watcher either never saw the event or never classified " +
        'the span, and the screen is reporting nothing observed when something was',
    ).not.toBe(opening)
    expect(
      settled.length,
      'the readout was blanked rather than rewritten, which says nothing to a volunteer ' +
        'reading it back down a phone line',
    ).toBeGreaterThan(0)
    expect(
      DIGIT.test(settled),
      `the readout put a digit on screen — "${settled}". T-38-06: no timing number, no ` +
        'interval count and no clock value is ever rendered, because a millisecond figure on ' +
        'a photographed screen is a fingerprint of the device',
    ).toBe(false)
  }, 120_000)

  /**
   * The diagnostics parameter, for the device on which nothing fires.
   *
   * This is the mode that makes Plan 38-04's device run produce data in the case that matters
   * most — a phone where **no** candidate signal is present. Without it the owner can only
   * report *nothing appeared*, which does not say which of the five declared candidates were
   * wrong, and a row that fires on neither device is supposed to be deleted rather than kept.
   *
   * The forced state must be unmistakable for a detection, so the headline says why it is
   * showing. Both pages are in one context with one difference between them.
   */
  it('shows the readout on demand for a device where no signal fired, and says why it is showing', async () => {
    const verdict = await readVerdict(forcedPage)
    expect(verdict, 'the page published no window.__o2EntryVerdict').not.toBeNull()
    // The floor: this arm is only about forcing if there was nothing to detect.
    expect(
      verdict?.embedded,
      'something was detected on the diagnostics page, so its notice may be showing for the ' +
        'ordinary reason and this case is not about the parameter at all',
    ).toBe(false)

    expect(
      await forcedPage.isVisible('#entry-notice'),
      'the diagnostics parameter did not raise the notice, so a device on which no candidate ' +
        'signal fires still yields nothing but a shrug',
    ).toBe(true)

    const forcedHeadline = ((await forcedPage.textContent('#entry-notice-headline')) ?? '').trim()
    const plainHeadline = ((await plainPage.textContent('#entry-notice-headline')) ?? '').trim()
    expect(
      forcedHeadline,
      `the forced notice carries the ordinary headline — "${forcedHeadline}" — so a reader ` +
        'photographing it cannot tell a parameter in the URL from something the page noticed',
    ).not.toBe(plainHeadline)
    expect(forcedHeadline.toLowerCase()).toContain('diagnostics')
    expect(
      DIGIT.test(forcedHeadline),
      `the diagnostics headline puts a digit on screen — "${forcedHeadline}"`,
    ).toBe(false)

    const signals = ((await forcedPage.textContent('#entry-notice-signals')) ?? '').trim()
    expect(
      signals.length,
      '#entry-notice-signals rendered an empty line on a page where nothing fired. On the ' +
        'device this mode exists for, an empty line and a broken readout look identical',
    ).toBeGreaterThan(0)
    expect(
      signals.toLowerCase(),
      `#entry-notice-signals reads "${signals}" and does not say in words that nothing fired`,
    ).toMatch(/nothing|none/)

    expect(
      await plainPage.isVisible('#entry-notice'),
      'the same browser without the parameter and without a bridge object shows the notice ' +
        'anyway, so the parameter is not what raised it and neither is a detection',
    ).toBe(false)
  }, 120_000)
})
