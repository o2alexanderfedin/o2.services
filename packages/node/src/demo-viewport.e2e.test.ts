import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * BROW-04's bar, measured rather than described — UI-SPEC section 6.3, properties B1-B7.
 *
 * ## Why this file exists at all
 *
 * `index.html` already carries a comment about an earlier `#bar` defect: *"Reported from
 * an iPhone; not caught here, because the tests asserted the `hidden` attribute rather
 * than whether anything was on screen."* **This is the same blind spot one property
 * over: nothing asserted that the bar FITS.** `built-bundle.e2e.test.ts` checks `#bar` is
 * visible and that `#bar-stats` says `of one thread`; `colouring-demo.e2e.test.ts` checks
 * `#bar-what` says `running work for`. Both are content assertions. A bar whose Stop
 * control sits past the right edge of a phone satisfies every one of them.
 *
 * Stop is not an ornament. The consent disclosure promises it in writing — *"The Stop
 * control in the bar. It ends the thread and closes the connections immediately"* — so a
 * Stop a visitor cannot reach is a promise the page does not keep.
 *
 * ## The defect this was written against
 *
 * Recorded on the roadmap, 2026-08-08, at a 393 CSS-pixel iPhone viewport: `#bar` is
 * **500px** wide, `#bar-what` and `#bar-stats` are flex children that do not wrap, the
 * page scrolls sideways, and `#stop` sits past **x=482** — off screen.
 *
 * **What THIS file measured, on the unfixed page, before the CSS contract landed** — so a
 * later reader can see whether the defect this spec was written against is the one it
 * still measures, rather than having to take the roadmap's word for it. It is NOT the
 * same reading, and saying so plainly is worth more than a table that agrees:
 *
 * | viewport | state | `#bar` width | `#bar` content | `#stop` right edge | `innerWidth` |
 * |---|---|---|---|---|---|
 * | 320 | idle | 320.00 | 320 | 302.41 | 320 |
 * | 320 | loaded | 320.00 | 320 | 302.41 | 320 |
 * | 360 | idle / loaded | 360.00 | 360 | 342.41 | 360 |
 * | 393 | idle / loaded | 393.00 | 393 | 375.41 | 393 |
 * | 768 | idle | 768.00 | 768 | 750.41 | 768 |
 * | 1280 | idle | 1280.00 | 1280 | 1262.41 | 1280 |
 *
 * **In headless Chromium at a pinned viewport the bar fits at every width, in both
 * states.** `documentElement.scrollWidth` equalled `innerWidth` exactly; `#bar`'s widest
 * child ended within 0.01px of `#bar`'s padding box; `#stop` was wholly on screen and
 * unoccluded. B1, B2, B2b, B4, B5, B6 and B7 were all green on the defective page. **One
 * property was red, at all five widths and in both states: `#stop` measured
 * 66.77 x 37.44, under B3's 44x44 target.**
 *
 * **The roadmap's 500px is an iOS Safari reading and this instrument cannot reproduce
 * it.** iOS Safari widens the layout viewport to fit overflowing content
 * ("shrink-to-fit"), so `#bar` — `position: fixed; inset: auto 0 0 0`, i.e. as wide as the
 * initial containing block — is reported at the widened 500px and `#stop` lands past
 * x=482. Chromium does not widen; Playwright exposes `isMobile` for Chromium only and it
 * does not add shrink-to-fit either. So the *page-level* symptom is not measurable here,
 * and B3's target and B2b's content check are what this file actually holds. That is a
 * weaker instrument than the roadmap implies, and it is recorded as one.
 *
 * ## What is measured, and in which states
 *
 * Five widths x 720, `deviceScaleFactor: 2` on the narrow three. Two bar states:
 *
 *   - **idle** — the page's own rendering with `servedFor` empty, i.e. whatever
 *     `renderBar` writes for a node that has been handed no work.
 *   - **loaded** — the longest string the bar's own templates can produce, written into
 *     `#bar-what` and `#bar-stats` with `page.evaluate` at measurement time. Derived from
 *     the templates in `index.html` rather than invented; see {@link LOADED_WHAT}. This is
 *     a test-time DOM write bounding a template, not a figure on a shipped page, and
 *     nothing here asserts on the strings — the copy is UI-SPEC section 4.1's business
 *     and this file's business is geometry.
 *
 * And on every surface the page offers: surfaces are enumerated as
 * `nav#surfaces [role="tab"]`, which is empty on the page as it stands today, so the loop
 * runs exactly once. When Plan 27-02 lands six tabs this same file covers all six with no
 * edit — a surface whose widest table forces page-level horizontal scroll is the same
 * defect one screen over.
 *
 * ## The one thing that makes the assertions honest
 *
 * **B6 forbids `overflow-x: hidden` on `html` or `body`.** Without it the whole file can
 * be satisfied by suppressing the scrollbar: B1 goes green, the page stops scrolling
 * sideways, and Stop is still off screen. That is the identical blind spot to the one
 * this file replaces, which is why the plant that proves this spec turns B6 red **while
 * B1 stays green**.
 *
 * ## What the plants established, including the one that came back green
 *
 * Six arms, one at a time, each restored by the surgical inverse of its own edit and each
 * verified with `cmp` against a snapshot taken immediately before it. Full text of every
 * observed failure is in 27-01-SUMMARY.md; the verdicts:
 *
 * | plant | result |
 * |---|---|
 * | remove `min-width: 0` from `#bar-what` | **green — nothing moved at all** |
 * | add `overflow-x: hidden` to `body` | **B6 red at all five widths, B1 green in the same run** |
 * | `white-space: nowrap` on `#bar-what`, `min-width: 0` kept | B2c red at 320/360/393; B2b green |
 * | `white-space: nowrap` on `#bar-what`, `min-width: 0` removed | **byte-identical readings to the arm above** |
 * | `white-space: nowrap` on `#bar-stats`, `min-width: 0` removed | B2c red at four widths; B2b green |
 * | `width: 600px` on `#bar-what` | B2b red at 320/360/393; B1, B2, B3 green |
 *
 * **`min-width: 0` is inert here, and that is a measurement rather than an opinion.**
 * UI-SPEC section 6.2 says the line is load-bearing and that "its removal must turn
 * section 6.3 red". It does not. Removing it changed not one box on either text child,
 * with wrapping content or with `white-space: nowrap` forced on — the two nowrap arms
 * produced identical numbers to the pixel. The reason is in the track definition, not the
 * child rule: a grid item's automatic minimum size is content-based only when it spans a
 * track whose **min** track sizing function is `auto`, and `minmax(0, 1fr)` fixes that min
 * at 0. The line is kept because it costs nothing and becomes load-bearing again the day
 * the track definition changes; it is documented here as inert so that nobody reads a
 * green plant as a passing spec.
 *
 * **What does carry the claim is B2c**, and after it B3's 44px target and B4's hit test.
 * The last arm is the sharpest thing in this table: a 600px child inside a 320px viewport
 * left B1, B2 and B3 green, because a fixed element's overflow reaches neither the
 * document's scroll width nor its own border box nor the grid tracks that place Stop.
 * Every property UI-SPEC section 6.3 lists was green over a bar three hundred pixels too
 * wide.
 *
 * ## Why every property is a soft assertion
 *
 * `expect.soft`, so one run reports every violated property at every width in both states
 * rather than stopping at the first. That is not a convenience: the first draft of this
 * file used hard assertions, B3's 44px target failed first at all five widths, and the
 * run said nothing whatever about B1, B2, B4, B5, B6 or B7 — which is precisely the
 * question the file was written to answer. A geometry spec that reports one number is a
 * geometry spec that has to be run once per property.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * The widths, from UI-SPEC section 6.3. 320 is the narrowest phone still in use, 393 is
 * the viewport the defect was reported from, 1280 is a laptop.
 *
 * A `BrowserContext` per size rather than `page.setViewportSize`, because Playwright only
 * accepts `deviceScaleFactor` at context creation — and a phone that reports 393 CSS
 * pixels is a 2x device, so measuring it at 1x would be measuring a viewport no phone has.
 */
const VIEWPORTS = [
  { width: 320, height: 720, deviceScaleFactor: 2 },
  { width: 360, height: 720, deviceScaleFactor: 2 },
  { width: 393, height: 720, deviceScaleFactor: 2 },
  { width: 768, height: 720, deviceScaleFactor: 1 },
  { width: 1280, height: 720, deviceScaleFactor: 1 },
] as const

const STATES = ['idle', 'loaded'] as const
type BarState = (typeof STATES)[number]

/**
 * The longest `#bar-what` the page's own template can emit, branch by branch.
 *
 * From `renderBar` in `index.html`: the `servedFor.length !== 0` arm is
 * `running work for ${...slice(0, 2).map((s) => `${short(s.peerId)} (${s.tasks})`).join(', ')}`
 * followed by `` ` +${servedFor.length - 2} more` `` when more than two peers are served.
 * `short(id)` is `${id.slice(0, 6)}…${id.slice(-4)}`, so eleven characters whatever the
 * peer id's real length. Two entries is the maximum the `slice(0, 2)` admits; six-digit
 * task counts and a three-digit overflow count bound the numbers.
 */
const LOADED_WHAT = 'running work for 12D3Ko…q9Xa (999999), 12D3Ko…7bZc (999999) +999 more'

/**
 * The longest `#bar-stats`, from the same function.
 *
 * `${Math.round(dutyCycle * 100)}% of one thread` — three digits at 100% — then the
 * `activity.hidden` arm ` (tab in background)`, then ` · ${tasksExecuted} task(s) done`
 * and ` · ${fetched} block(s) in`, both at six digits. Every clause is present because
 * every clause can be.
 */
const LOADED_STATS = '100% of one thread (tab in background) · 999999 task(s) done · 999999 block(s) in'

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly right: number
  readonly bottom: number
}

interface Reading {
  readonly innerWidth: number
  readonly innerHeight: number
  readonly scrollWidth: number
  readonly bar: Box | null
  readonly barScrollWidth: number | null
  readonly stop: Box | null
  /** `'stop'`, `'descendant'`, `'other:<tag#id>'`, or `'none'` when the centre is off screen. */
  readonly stopCentreOwner: string
  readonly htmlOverflowX: string
  readonly bodyOverflowX: string
  readonly surfaces: Box | null
  /** The rightmost / leftmost edge of any element child of `#bar`, and `#bar`'s padding box. */
  readonly childRight: number | null
  readonly childLeft: number | null
  readonly barPadRight: number | null
  readonly barPadLeft: number | null
  /**
   * Per child of `#bar`: how wide its content is against how wide its box is.
   *
   * B2b measures BOXES and is blind to a child whose box fits while its text hangs out of
   * it — which is exactly what `min-width: 0` produces when the content cannot wrap.
   * Measured, not assumed; see the three-arm plant recorded in 27-01-SUMMARY.md.
   */
  readonly childContent: readonly { readonly name: string; readonly scrollWidth: number; readonly clientWidth: number }[]
  /** After scrolling to the end of the page: the bottom of `#main`'s last element child. */
  readonly mainLastBottom: number | null
  readonly mainLastTag: string | null
  /** `#bar`'s top, read in the same frame as {@link mainLastBottom}. */
  readonly barTopAtEnd: number | null
  /**
   * The bottom of `#measurements`, the footer that sits OUTSIDE `#main`.
   *
   * Recorded and not asserted. B5 is defined by UI-SPEC section 6.3 against `#main`'s last
   * element child, and the footer is a sibling of `#main` rather than a child of it — so
   * this number is outside the property as written. It is read anyway because the reading
   * is a finding: see the note on B5 in the test body.
   */
  readonly footerBottom: number | null
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const contexts: BrowserContext[] = []

/**
 * Consent through `#allow` and start through `#join` — the page's own controls, not
 * `window.o2` directly.
 *
 * The geometry this file measures is the geometry a visitor gets, and a visitor arrives
 * through the gate. Driving `window.o2.start` instead would measure a bar the page never
 * put on screen by the route anybody uses.
 */
async function openAt(viewport: (typeof VIEWPORTS)[number]): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
  })
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${viewport.width}px] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      process.stderr.write(`[${viewport.width}px] console: ${message.text()}\n`)
    }
  })

  // A static host has no `/bootstrap.json`, so the relay comes from the link — the same
  // path `built-bundle.e2e.test.ts` exercises, and the only one available here.
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  await page.waitForFunction(
    () => document.getElementById('gate')?.hasAttribute('hidden') === false,
    null,
    { timeout: 30_000 },
  )
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
  // clicks the button.
  await page.click('#allow')
  await page.waitForFunction(
    () => document.getElementById('main')?.hasAttribute('hidden') === false,
    null,
    { timeout: 30_000 },
  )
  await page.waitForFunction(
    () => document.getElementById('join')?.hasAttribute('disabled') === false,
    null,
    { timeout: 60_000 },
  )
  await page.click('#join')
  // The bar appears because a node EXISTS, not because the join handler finished — it
  // goes on waiting for a WebRTC address afterwards, and BROW-04 does not wait with it.
  await page.waitForSelector('#bar', { state: 'visible', timeout: 120_000 })
  return page
}

/**
 * How many surfaces the page offers, which is zero today.
 *
 * Enumerated rather than assumed, so the five surfaces that do not exist yet are covered
 * by this file the day they land instead of by a rewrite of it.
 */
async function surfaceCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('nav#surfaces [role="tab"]').length)
}

/**
 * One surface, one bar state, every property in UI-SPEC section 6.3, read in one pass.
 *
 * **Everything happens inside a single `page.evaluate` on purpose.** `reconcile` runs on
 * a 1000 ms interval and rewrites `#bar-what` and `#bar-stats` from the node's real
 * activity, so a `loaded` state written by one round trip and measured by the next would
 * be measuring whatever the interval last wrote. The strings are therefore re-applied
 * immediately before each layout read, and the two reads that need a frame between them
 * are separated by exactly one `requestAnimationFrame`.
 */
async function measure(page: Page, state: BarState, surfaceIndex: number): Promise<Reading> {
  return page.evaluate(
    async ([barState, index, whatText, statsText]) => {
      const boxOf = (element: Element | null): Box | null => {
        if (element === null) return null
        const rect = element.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        }
      }
      const frame = async (): Promise<void> =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })

      // The bounded-maximum strings, re-applied before every layout read. `idle` is the
      // page's own rendering and is deliberately left alone.
      const apply = (): void => {
        if (barState !== 'loaded') return
        const what = document.getElementById('bar-what')
        const stats = document.getElementById('bar-stats')
        if (what !== null) what.textContent = whatText as string
        if (stats !== null) stats.textContent = statsText as string
      }

      const tabs = Array.from(document.querySelectorAll('nav#surfaces [role="tab"]'))
      const tab = tabs[index as number]
      if (tab instanceof HTMLElement) {
        tab.click()
        await frame()
      }

      apply()
      await frame()

      const bar = document.getElementById('bar')
      const stop = document.getElementById('stop')
      const stopBox = boxOf(stop)

      // B4. `elementFromPoint` takes VIEWPORT coordinates, so a centre outside the
      // viewport returns null — which is a failure of this property and not an
      // exception to it: nothing can be reached at a point that is not on screen.
      let owner = 'none'
      if (stopBox !== null) {
        const hit = document.elementFromPoint(
          stopBox.x + stopBox.width / 2,
          stopBox.y + stopBox.height / 2,
        )
        if (hit === null) owner = 'none'
        else if (hit === stop) owner = 'stop'
        else if (stop !== null && stop.contains(hit)) owner = 'descendant'
        else owner = `other:${hit.tagName.toLowerCase()}${hit.id === '' ? '' : `#${hit.id}`}`
      }

      const html = getComputedStyle(document.documentElement)
      const body = getComputedStyle(document.body)

      // B2b. The union of the bar's element children against the bar's own PADDING box.
      //
      // This is measured because B1 is structurally blind to this element and B2 cannot
      // see inside it. `#bar` is `position: fixed`, and in Chromium a fixed element's
      // overflow does not join the document's scrollable overflow — so a bar whose
      // children hang off its right edge leaves `documentElement.scrollWidth` at
      // `innerWidth` and leaves `#bar`'s own box at `innerWidth` too, and B1 and B2 both
      // go green over a bar that does not fit. Measured, not assumed: on the unfixed page
      // both readings were exactly `innerWidth` at all five widths.
      //
      // The padding box rather than the border box, because the bar's padding is what
      // keeps its content off the screen edge; a child that eats its own padding has
      // already overflowed as far as a visitor is concerned.
      const children = bar === null ? [] : Array.from(bar.children)
      const childRects = children.map((child) => child.getBoundingClientRect())
      const barStyle = bar === null ? null : getComputedStyle(bar)
      const barRect = bar === null ? null : bar.getBoundingClientRect()

      const reading = {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        bar: boxOf(bar),
        barScrollWidth: bar === null ? null : bar.scrollWidth,
        stop: stopBox,
        stopCentreOwner: owner,
        htmlOverflowX: html.overflowX,
        bodyOverflowX: body.overflowX,
        surfaces: boxOf(document.getElementById('surfaces')),
        childRight: childRects.length === 0 ? null : Math.max(...childRects.map((r) => r.right)),
        childLeft: childRects.length === 0 ? null : Math.min(...childRects.map((r) => r.left)),
        barPadRight:
          barRect === null || barStyle === null
            ? null
            : barRect.right - Number.parseFloat(barStyle.paddingRight),
        barPadLeft:
          barRect === null || barStyle === null
            ? null
            : barRect.left + Number.parseFloat(barStyle.paddingLeft),
        // Grid items are blockified, so `clientWidth`/`scrollWidth` are meaningful here
        // even on the `<strong>` and `<span>` the bar is built from.
        childContent: children.map((child) => ({
          name: `${child.tagName.toLowerCase()}${child.id === '' ? '' : `#${child.id}`}`,
          scrollWidth: child.scrollWidth,
          clientWidth: child.clientWidth,
        })),
        mainLastBottom: null as number | null,
        mainLastTag: null as string | null,
        barTopAtEnd: null as number | null,
      }

      // B5. Taken at the END of the page, because that is where a fixed bar covers
      // something: the bottom padding has to clear it, and only the last element proves
      // it does.
      //
      // **This arithmetic holds only while the surface nav is `position: sticky` rather
      // than `fixed`** (UI-SPEC section 6.4). A second fixed element would add a term
      // this comparison does not carry, and would make a covered element look clear.
      window.scrollTo(0, document.body.scrollHeight)
      await frame()
      apply()
      await frame()
      const last = document.getElementById('main')?.lastElementChild ?? null
      const lastBox = boxOf(last)
      const barAtEnd = boxOf(document.getElementById('bar'))
      return {
        ...reading,
        mainLastBottom: lastBox === null ? null : lastBox.bottom,
        mainLastTag:
          last === null ? null : `${last.tagName.toLowerCase()}${last.id === '' ? '' : `#${last.id}`}`,
        barTopAtEnd: barAtEnd === null ? null : barAtEnd.y,
        footerBottom: boxOf(document.getElementById('measurements'))?.bottom ?? null,
      }
    },
    [state, surfaceIndex, LOADED_WHAT, LOADED_STATS] as const,
  )
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-demo-viewport-'))

  // DET-03. This node relays and executes nothing — the subject here is the page's
  // layout, not provenance, and no artifact is dispatched anywhere in this file. Stating
  // the opt-out is the point of the field being required; `built-bundle.e2e.test.ts`
  // takes the same position for the same reason.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    // One reservation per viewport, and each viewport is its own `BrowserContext` with
    // its own origin storage and therefore its own peer identity.
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
}, 180_000)

afterAll(async () => {
  for (const context of contexts) {
    for (const page of context.pages()) {
      await page.evaluate(async () => window.o2.stop()).catch(() => {})
    }
    await context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('UI-SPEC section 6.3 — the bar fits, and Stop is reachable', () => {
  for (const viewport of VIEWPORTS) {
    it(`holds B1-B7 at ${viewport.width} CSS pixels, in both bar states`, async () => {
      const page = await openAt(viewport)
      const surfaces = await surfaceCount(page)
      // Zero surfaces is the page as it stands today, and one pass over it is the honest
      // reading of "every surface the page offers". Six tabs make this six passes.
      const passes = Math.max(1, surfaces)

      for (const state of STATES) {
        for (let index = 0; index < passes; index += 1) {
          const where = `${viewport.width}px / ${state} / surface ${index + 1} of ${passes}`
          const reading = await measure(page, state, index)

          expect(reading.bar, `${where}: #bar is not in the document at all`).not.toBeNull()
          expect(reading.stop, `${where}: #stop is not in the document at all`).not.toBeNull()
          const bar = reading.bar as Box
          const stop = reading.stop as Box

          // B1 — the page does not scroll sideways.
          expect.soft(
            reading.scrollWidth,
            `B1 ${where}: documentElement.scrollWidth ${reading.scrollWidth} exceeds ` +
              `innerWidth ${reading.innerWidth} + 1 — the page scrolls sideways`,
          ).toBeLessThanOrEqual(reading.innerWidth + 1)

          // B2 — the bar's own box is inside the viewport.
          expect.soft(
            bar.x,
            `B2 ${where}: #bar starts at x=${bar.x.toFixed(2)}, left of the viewport`,
          ).toBeGreaterThanOrEqual(0)
          expect.soft(
            bar.right,
            `B2 ${where}: #bar is ${bar.width.toFixed(2)}px wide and ends at ` +
              `x=${bar.right.toFixed(2)}, past innerWidth ${reading.innerWidth} ` +
              `(its content measures ${String(reading.barScrollWidth)}px)`,
          ).toBeLessThanOrEqual(reading.innerWidth + 1)

          // B2b — and the bar's CONTENT is inside the bar.
          //
          // Not in UI-SPEC section 6.3's table, and added here deliberately rather than
          // by oversight. B1 and B2 are both blind to this element for a measured reason
          // recorded beside the reading: `#bar` is fixed, so its overflow reaches neither
          // `documentElement.scrollWidth` nor its own border box, and a Stop control
          // pushed off the right edge of a phone leaves every property in the table
          // green. This is the assertion that sees it — and the one that reddens when the
          // bar's children stop being allowed to shrink.
          expect.soft(
            reading.childRight,
            `B2b ${where}: the bar's widest child reaches ` +
              `x=${(reading.childRight ?? 0).toFixed(2)} against #bar's padding box which ` +
              `ends at x=${(reading.barPadRight ?? 0).toFixed(2)} — the bar's content does ` +
              'not fit inside the bar',
          ).toBeLessThanOrEqual((reading.barPadRight ?? 0) + 1)
          expect.soft(
            reading.childLeft,
            `B2b ${where}: the bar's leftmost child starts at ` +
              `x=${(reading.childLeft ?? 0).toFixed(2)}, left of #bar's padding box at ` +
              `x=${(reading.barPadLeft ?? 0).toFixed(2)}`,
          ).toBeGreaterThanOrEqual((reading.barPadLeft ?? 0) - 1)

          // B2c — and each child's CONTENT is inside that child.
          //
          // Added because Plant 1 came back green and the plan's own instruction for that
          // case is to widen rather than to record a gap. `min-width: 0` lets a grid item
          // shrink to its track; when the item's content cannot wrap, the item's BOX then
          // fits while its text hangs off the right of it — B2b measures boxes and cannot
          // see that, B1 and B2 are blind to it for the fixed-element reason above, and
          // Stop stays put because the track sizes are unaffected. Every property in
          // UI-SPEC 6.3's table stays green over a bar whose text is off screen. This is
          // the one that reddens. The three-arm plant that establishes it — nowrap alone,
          // nowrap without `min-width: 0`, and both restored — is in 27-01-SUMMARY.md.
          if (reading.childContent.length > 0) {
            const worst = reading.childContent.reduce((a, b) =>
              b.scrollWidth - b.clientWidth > a.scrollWidth - a.clientWidth ? b : a,
            )
            expect.soft(
              worst.scrollWidth,
              `B2c ${where}: ${worst.name}'s content measures ${worst.scrollWidth}px ` +
                `inside a ${worst.clientWidth}px box — the text overflows its own child`,
            ).toBeLessThanOrEqual(worst.clientWidth + 1)
          }

          // B3 — the promised control is wholly on screen, at a size a finger can hit.
          expect.soft(
            stop.x,
            `B3 ${where}: #stop starts at x=${stop.x.toFixed(2)}, left of the viewport`,
          ).toBeGreaterThanOrEqual(0)
          expect.soft(
            stop.right,
            `B3 ${where}: #stop's right edge is x=${stop.right.toFixed(2)} against ` +
              `innerWidth ${reading.innerWidth} — the Stop control is off screen ` +
              `(#bar measures ${bar.width.toFixed(2)}px, content ${String(reading.barScrollWidth)}px)`,
          ).toBeLessThanOrEqual(reading.innerWidth + 1)
          expect.soft(
            stop.y,
            `B3 ${where}: #stop starts at y=${stop.y.toFixed(2)}, above the viewport`,
          ).toBeGreaterThanOrEqual(0)
          expect.soft(
            stop.bottom,
            `B3 ${where}: #stop's bottom is y=${stop.bottom.toFixed(2)} against ` +
              `innerHeight ${reading.innerHeight} — the Stop control is below the fold`,
          ).toBeLessThanOrEqual(reading.innerHeight + 1)
          expect.soft(
            stop.width,
            `B3 ${where}: #stop is ${stop.width.toFixed(2)}px wide, under the 44px target`,
          ).toBeGreaterThanOrEqual(44)
          expect.soft(
            stop.height,
            `B3 ${where}: #stop is ${stop.height.toFixed(2)}px tall, under the 44px target`,
          ).toBeGreaterThanOrEqual(44)

          // B4 — nothing overlays the centre of the promised control.
          expect.soft(
            reading.stopCentreOwner,
            `B4 ${where}: elementFromPoint at #stop's centre ` +
              `(${(stop.x + stop.width / 2).toFixed(2)}, ${(stop.y + stop.height / 2).toFixed(2)}) ` +
              `returned ${reading.stopCentreOwner}`,
          ).toMatch(/^(?:stop|descendant)$/)

          // B5 — with the page scrolled to its end, the bar covers nothing.
          //
          // **This property is narrower than it reads, and the gap is a measured finding
          // rather than a caveat.** UI-SPEC section 6.3 defines B5 against `#main`'s last
          // element child, and `#measurements` — the footer carrying the link to the
          // benchmark page — is a SIBLING of `#main`, not a child. So B5 is silent about
          // it. On the unfixed page, at the end of the page, the footer's bottom read
          // 599.8 / 600.2 / 600.1 against `#bar`'s top at 558.9 at 320 / 360 / 393 CSS
          // pixels: **the footer was under the bar at all three narrow widths and B5 was
          // green throughout.** `footerBottom` is read for that reason and is deliberately
          // not asserted here — widening a property mid-plan would make this file's red
          // depend on a figure UI-SPEC has not agreed. It is carried to the phase's
          // deferred items instead.
          expect.soft(
            reading.mainLastBottom,
            `B5 ${where}: #main has no last element child to measure`,
          ).not.toBeNull()
          expect.soft(
            reading.barTopAtEnd,
            `B5 ${where}: #bar vanished between the scroll and the read`,
          ).not.toBeNull()
          expect.soft(
            reading.mainLastBottom as number,
            `B5 ${where}: at the end of the page, #main's last child ` +
              `(${String(reading.mainLastTag)}) has its bottom at ` +
              `y=${(reading.mainLastBottom as number).toFixed(2)}, below #bar's top at ` +
              `y=${(reading.barTopAtEnd as number).toFixed(2)} — the bar covers it`,
          ).toBeLessThanOrEqual(reading.barTopAtEnd as number)

          // B6 — and the fix was not faked by suppressing the scrollbar.
          expect.soft(
            reading.htmlOverflowX,
            `B6 ${where}: html has computed overflow-x: ${reading.htmlOverflowX}, which ` +
              'makes B1 pass while Stop can still be off screen — UI-SPEC 6.2 forbids it',
          ).not.toBe('hidden')
          expect.soft(
            reading.bodyOverflowX,
            `B6 ${where}: body has computed overflow-x: ${reading.bodyOverflowX}, which ` +
              'makes B1 pass while Stop can still be off screen — UI-SPEC 6.2 forbids it',
          ).not.toBe('hidden')

          // B7 — the surface nav, when there is one. It may scroll within itself; what it
          // may not do is escape the viewport.
          const nav = reading.surfaces
          const navInside = nav === null ? true : nav.x >= 0 && nav.right <= reading.innerWidth + 1
          expect.soft(
            navInside,
            nav === null
              ? `B7 ${where}: no #surfaces element on the page yet — vacuous until Plan 27-02`
              : `B7 ${where}: #surfaces spans x=${nav.x.toFixed(2)}..${nav.right.toFixed(2)} ` +
                `against innerWidth ${reading.innerWidth}`,
          ).toBe(true)
        }
      }
    }, 300_000)
  }
})
