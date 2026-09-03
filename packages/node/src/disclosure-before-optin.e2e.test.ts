import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DISCLOSED_DATA_COST_BYTES, DISCLOSURE, DISCLOSURE_VERSION } from '@o2/browser'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'

/**
 * BROW-09's ordering half — the four things are on screen **before** the button can be clicked.
 *
 * Criterion 4's second sentence is the one this file is for: *"a disclosure shown after the
 * opt-in click fails whatever it says."* `disclosure-four-elements.node.test.ts` owns the
 * content and can be exhaustive about it with no browser; what it cannot see is a page that
 * holds a complete disclosure in a module and paints it a moment too late.
 *
 * ## The reading is taken BEFORE any click, and that is the whole assertion
 *
 * Not "the text is present at some point", which a page that renders the terms *in the click
 * handler* would also satisfy. The case waits for `#gate` to be visible, reads its rendered
 * text and `#allow`'s actionability, and only then clicks. Everything asserted is asserted
 * about the state a visitor is in while the button is still unpressed.
 *
 * ## Why the expected text comes from `DISCLOSURE` rather than from literals
 *
 * The four elements' wording is already pinned, character by character, by the node-lane guard.
 * Repeating the literals here would give one fact two spellings and would make a rewording a
 * two-file edit for no gain. What this file adds is that **what that module says is what this
 * page shows**, so comparing the page against the module is the comparison worth making —
 * `demo/index.html` renders `window.o2.disclosure()` and nothing else, and this is the reading
 * that would catch it rendering something else.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

let server: ViteDevServer
let baseUrl: string
let browser: Browser

beforeAll(async () => {
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`
  browser = await launchFixtureBrowser(chromium)
}, 180_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}, 120_000)

describe('BROW-09 — the disclosure is on screen before the opt-in control can be clicked', () => {
  it('shows all four elements, and the affirm control, with the button still unpressed', async () => {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}${PAGE}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.waitForFunction(
      () => document.getElementById('gate')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )

    // Visibility, not the attribute: an id rule that sets `display` outranks the browser's own
    // `[hidden]`, so the attribute can be correct while the element is on screen — which is how
    // an "always-visible" bar came to be visible while idle, reported from a phone rather than
    // caught here.
    expect(await page.isVisible('#gate')).toBe(true)
    expect(await page.isVisible('#main')).toBe(false)

    const gateText = (await page.textContent('#gate')) ?? ''

    // Every line of the disclosure, question and answer, before the click. The loop is over
    // `DISCLOSURE.lines` rather than over a list of four, so a fifth element added later is
    // covered here without anybody remembering to extend this case.
    for (const line of DISCLOSURE.lines) {
      expect(
        gateText,
        `BROW-09: the gate does not show the question "${line.question}" before the opt-in ` +
          'control can be clicked',
      ).toContain(line.question)
      expect(
        gateText,
        `BROW-09: the gate shows the question "${line.question}" and not its answer, so a ` +
          'visitor reads the heading of a disclosure rather than the disclosure',
      ).toContain(line.answer)
    }

    // BROW-10 — the byte figure, asserted BY NAME rather than only as a member of the loop
    // above. A line that is deleted disappears from `DISCLOSURE.lines` and from the loop with
    // it, so the loop cannot notice its absence; this is the assertion that can.
    expect(
      gateText,
      'BROW-10: the gate shows no data cost in bytes before the opt-in control can be clicked',
    ).toContain(`${String(Math.round(DISCLOSED_DATA_COST_BYTES / 1000))} kilobytes`)

    // The optional extra and the version, which is what tells a returning visitor the terms
    // moved. Both are part of what is on screen before the decision.
    expect(gateText).toContain(DISCLOSURE.reporting.question)
    expect(gateText).toContain(DISCLOSURE.reporting.answer)
    expect(gateText).toContain(DISCLOSURE_VERSION)

    // The control is not merely present, it is **actionable** — the ordering claim is that a
    // visitor could press it right now, having read all of the above.
    await page.locator('#allow').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.isEnabled('#allow')).toBe(true)
    expect(await page.textContent('#allow')).toBe(DISCLOSURE.affirm)
    // A "no" is a control on the page, not the absence of one — `policy.html`'s own wording.
    expect(await page.isVisible('#decline')).toBe(true)
    expect(await page.textContent('#decline')).toBe(DISCLOSURE.decline)

    // The unticked box, checked here rather than assumed: a pre-ticked optional extra would
    // make the answer above a default rather than a decision.
    expect(await page.isChecked('#reporting')).toBe(false)

    // And only now is it pressed. What follows is the ordinary path and is asserted so the
    // case cannot pass on a gate that shows everything and does nothing.
    await page.click('#allow')
    await page.waitForFunction(
      () => document.getElementById('main')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )
    expect(await page.isVisible('#main')).toBe(true)
    expect(await page.isVisible('#gate')).toBe(false)

    await page.close()
  }, 180_000)
})
