import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONSENT_KEY, DISCLOSED_DATA_COST_BYTES, DISCLOSURE, DISCLOSURE_VERSION } from '@o2/browser'
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
    // **What answering the gate reveals is `#signin`, not `#main` — `42-04`.** The ordering
    // this file is about is unchanged and is if anything longer: the gate is still the first
    // thing on screen, still answered before anything else is offered, and now what follows
    // it is an invitation to sign in rather than the workload surfaces themselves. The
    // assertion above — `#main` is not visible BEFORE consent — is untouched and is still
    // the one that carries BROW-01.
    await page.waitForFunction(
      () => document.getElementById('signin')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )
    expect(await page.isVisible('#signin')).toBe(true)
    expect(await page.isVisible('#gate')).toBe(false)
    // And `#main` is STILL not on screen: consent alone does not open the workload surfaces.
    expect(await page.isVisible('#main')).toBe(false)

    await page.close()
  }, 180_000)
})

/**
 * BROW-09's other half — a RETURNING visitor is told what changed, not merely that it changed.
 *
 * ## This existed as a constant and as nothing else
 *
 * `CONSENT_VERSION_NOTE` has been exported since disclosure version 3, and
 * `disclosure-four-elements.node.test.ts` asserted it was non-empty. **Nothing rendered it.**
 * Measured 2026-09-07 against the bundle published to GitHub Pages: of the sixteen strings
 * `disclosure.ts` ships, fifteen were in the four published chunks and this one was not,
 * because `demo/index.html` never asked for it. The page said *"What this page does has
 * changed since you last agreed"* in its small print and never said WHAT — and the bump on
 * which that was found is the worst one for it: version 7 told visitors a fresh key was made
 * each visit and written nowhere, version 8 tells them the opposite.
 *
 * A non-empty constant nobody renders is the shape of a guard that cannot see the property it
 * names. So the assertion here is against the SCREEN.
 *
 * ## The stale record is written before the page loads, not after
 *
 * `addInitScript` runs before any script on the page, so the first synchronous
 * `consentState()` — the one that paints the gate — already sees it. Writing it afterwards
 * and reloading would test the same thing more slowly; writing it after load and NOT
 * reloading would test nothing, because the gate is painted once.
 */
describe('BROW-09 — a returning visitor whose terms moved is told WHAT moved', () => {
  /**
   * A consent record answered under an older version — the shape `grantConsent` WRITES.
   *
   * The field is `disclosureVersion`, not `version`. The first draft of this case guessed
   * `version` and the precondition below caught it: `readConsent` answered `unreadable`, not
   * `terms-changed`, so the case would have been asserting against a visitor whose storage was
   * broken rather than one whose terms had moved. That precondition is the only reason anybody
   * knows the difference, which is why it is an assertion and not a comment.
   *
   * `anchoredTo` is a STRING as `describeAnchors` renders it — and it is deliberately left as
   * the empty string here rather than made to match, because `readConsent` checks the anchors
   * only AFTER the version and this case is about the version.
   */
  const staleRecord = JSON.stringify({
    disclosureVersion: '1',
    grantedAt: 1_700_000_000_000,
    reportingAllowed: false,
    anchoredTo: '',
  })

  it('shows the version note, and shows the current terms beside it', async () => {
    const page = await browser.newPage()
    await page.addInitScript(
      ([key, record]) => {
        window.localStorage.setItem(key, record)
      },
      [CONSENT_KEY, staleRecord] as const,
    )
    await page.goto(`${baseUrl}${PAGE}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.waitForFunction(
      () => document.getElementById('gate')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )

    // The precondition, asserted rather than assumed: without it this case would pass on a
    // first-time visitor, for whom the note is deliberately absent, and would then be a case
    // that cannot fail for the reason it exists.
    const state = await page.evaluate(() => window.o2.consentState())
    expect(
      state.gap,
      'the stale record did not produce a terms-changed gap, so this case is not measuring a ' +
        'returning visitor at all',
    ).toBe('terms-changed')

    expect(await page.isVisible('#gate-version-note')).toBe(true)
    const noteText = (await page.textContent('#gate-version-note')) ?? ''
    // The whole note, as a literal from the module the page renders from — not a fragment, and
    // not recomputed here by the same expression the page uses.
    expect(
      noteText,
      'the gate tells a returning visitor that the terms changed and not what changed',
    ).toContain(DISCLOSURE.versionNote)

    // And it is genuinely on the gate the visitor is reading, above the terms rather than in
    // a corner of the page.
    const gateText = (await page.textContent('#gate')) ?? ''
    expect(gateText).toContain(DISCLOSURE.versionNote)
    for (const line of DISCLOSURE.lines) expect(gateText).toContain(line.answer)

    await page.close()
  }, 180_000)

  it('shows NOTHING to a first-time visitor, so the note is a diff and not a banner', async () => {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}${PAGE}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.waitForFunction(
      () => document.getElementById('gate')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )

    const state = await page.evaluate(() => window.o2.consentState())
    expect(state.gap).toBe('never-asked')
    expect(await page.isVisible('#gate-version-note')).toBe(false)
    expect((await page.textContent('#gate')) ?? '').not.toContain(DISCLOSURE.versionNote)

    await page.close()
  }, 180_000)
})
