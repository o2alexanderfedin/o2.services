import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { perfReport } from '../../browser/vite.config.ts'
import { PROVENANCE, SOURCE_DOCUMENT } from '../../browser/demo/surfaces/bench.ts'
import { launchFixtureBrowser } from './e2e-browser-launch.ts'

/**
 * **P9 — every figure on the Benchmarks surface occurs verbatim in the committed document.**
 *
 * UI-SPEC section 9's P9 row, and section 4.7's fourth requirement: *"a number on this
 * surface that is not in that document is the defect this surface is most likely to
 * introduce."* This file is the check, and its shape follows from that sentence: it reads
 * `docs/perf/prime-and-pi-benchmarks.md` off disk and requires every figure string the page
 * renders inside `#s-bench` to occur in it as a substring. The expectation comes from the
 * committed document and never from the surface — a guard that reads its expectation off the
 * thing under test cannot fail.
 *
 * # What the splitter catches, and what it does not
 *
 * {@link FIGURE} is a maximal run of digits joined by decimal points, hyphens, carets and
 * the letter `x`, with an optional trailing `x` or `%`. It catches `3.64x`, `0.998`, `1187`,
 * `10^7`, `3x10^8`, `46%` and `2026-08-02`.
 *
 * **Its hole, stated rather than left to be found.** It is a rule over glyphs. A figure
 * spelled out in words — *three point six four times* — is invisible to it, exactly as
 * `DIGIT` in `packages/browser/src/demo-regions.ts` is blind to *forty-one*. The alternative,
 * a rule against number *words*, would fire on the surface's own prose. So the hole is real
 * and it is the {@link FLOOR} that stops it mattering: a surface that had quietly replaced
 * its tables with sentences would fall under the floor and redden, and a surface that
 * rendered nothing at all could not pass by having no figures to check.
 *
 * # The floor is derived from the document's tables, not from the surface's
 *
 * If the count came from `surfaces/bench.ts`'s own arrays it would shrink with them, and a
 * transcription that had lost half its rows would still pass. It is written out below from
 * the shapes of the four tables in the committed document.
 *
 * # What is NOT asserted here
 *
 * The direction P9 cannot see: a figure in the document that this surface fails to render.
 * P9 is a subset check, and every figure on screen occurring in the document is satisfied
 * perfectly by a blank surface. The floor is the only thing holding that direction, and it
 * holds it by count rather than by identity — a surface rendering 171 copies of `1187` would
 * pass. Said plainly rather than left implied.
 *
 * # Written after the surface, and the plants are what carry the claim
 *
 * The plan marks this task `tdd="true"` and it is not what happened: `surfaces/bench.ts` and
 * the markup landed in Task 1, and every case below passed on its first run. **No RED was
 * observed for these cases at the time they were written.** What establishes that they can
 * fail is the pair of plants the plan names — one rounding a figure, one inventing one — both
 * watched red and both recorded in 27-09-SUMMARY.md with the failure text.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * A figure string: a run of digits, with `.`, `-`, `^` and `x` admitted **between** digits
 * and `x` or `%` admitted at the end.
 *
 * The internal `x` is what keeps `3x10^8` whole; the internal `-` is what keeps `2026-08-02`
 * whole. Both are the document's own notation.
 */
const FIGURE = /\d+(?:[.\-^x]\d+)*(?:x|%)?/g

/**
 * The minimum number of figure strings the surface must render, derived from the committed
 * document's own table shapes rather than from the transcription of them:
 *
 * | source | shape | figure-bearing cells |
 * |---|---|---|
 * | section 5, real parallel speedup | 8 rows | 7 (domain, processes, wall, sum guest, straggler, speedup, efficiency) = 56 |
 * | section 4, fabric overhead | 10 rows | 8 (workload, shards, redundancy, local, map, reduce, total, tax) = 80 |
 * | section 2, decomposition cost | 7 rows | 4 (shards, sum, one shard, ratio) = 28 |
 * | section 3, instantiate cold | 2 rows | 2 (p50, module bytes) = 4 |
 * | the provenance line | — | 3 (the date, the core count, the engine version) |
 *
 * 56 + 80 + 28 + 4 + 3 = 171. The observed count is higher, because column headers and the
 * surface's own prose carry figures too (`p50`, *best of 3 runs*, *9 repetitions*, *above
 * 1.0*); the floor is the part that follows from the document and nothing else.
 */
const FLOOR = 56 + 80 + 28 + 4 + 3

let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let base: string
let document_: string

/** Every figure string on the surface, in DOM order, with the region it came from. */
let figures: readonly { readonly region: string; readonly figure: string }[] = []
/** The whole rendered text of `#s-bench`, kept so a failure can quote its surroundings. */
let surfaceText = ''

beforeAll(async () => {
  document_ = await readFile(join(ROOT, SOURCE_DOCUMENT), 'utf8')

  // **The dev server is started with the perf plugin**, which every other e2e spec's server
  // is not: they call `createServer({ root: ROOT })` and there is no `vite.config.ts` at the
  // repository root, so no plugin is loaded. Importing the same factory the real build uses
  // is what makes the `./perf/index.html` case below a check on the shipped configuration
  // rather than on a fixture written to agree with it.
  //
  // No relay and no node. This surface reads nothing, blocks nothing and calls no method on
  // `window.o2`, so a fabric would be seconds of setup buying no coverage — and a page with
  // no node is also the honest state to assert *cited figures are present anyway* in.
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    plugins: [perfReport()],
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  base = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
  context = await browser.newContext()
  page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[page error] ${error.message}\n`)
  })

  await page.goto(`${base}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: the harness consents by pressing the button.
  await page.click('#allow')
  await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
  // The visitor's own way in: press the tab, which writes `location.hash`.
  await page.click('#nav-bench')
  await page.waitForSelector('#s-bench', { state: 'visible', timeout: 30_000 })

  const walked = await page.evaluate(() => {
    const panel = document.getElementById('s-bench')
    if (panel === null) throw new Error('#s-bench is not in the document')
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
    const out: { region: string; text: string }[] = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const raw = node.nodeValue ?? ''
      if (raw.trim() === '') continue
      // Which region the text sits under, for the failure message. A text node with no
      // region ancestor is reported as `(undeclared)` — P2 in `demo-regions.e2e.test.ts` is
      // the property that forbids that, and naming it here saves a second run to find out.
      let region = '(undeclared)'
      for (let el = node.parentElement; el !== null; el = el.parentElement) {
        const declared = el.getAttribute('data-region')
        if (declared !== null) {
          region = declared
          break
        }
      }
      out.push({ region, text: raw })
    }
    return { nodes: out, all: panel.textContent ?? '' }
  })

  surfaceText = walked.all
  const collected: { region: string; figure: string }[] = []
  for (const node of walked.nodes) {
    for (const match of node.text.matchAll(FIGURE)) {
      collected.push({ region: node.region, figure: match[0] })
    }
  }
  figures = collected

  process.stderr.write(
    `[P9] ${figures.length} figure string(s) extracted from #s-bench, floor ${FLOOR}\n` +
      `[P9] by region: ${[...new Set(figures.map((f) => f.region))]
        .map((r) => `${r}=${figures.filter((f) => f.region === r).length}`)
        .join(', ')}\n`,
  )
}, 300_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}, 60_000)

describe('P9 — the Benchmarks surface cites, and does not compute', () => {
  it('extracted more figure strings than the document\'s own tables contain cells', () => {
    expect(
      figures.length,
      `P9 examined ${figures.length} figure string(s) against a floor of ${FLOOR} derived ` +
        `from the four tables in ${SOURCE_DOCUMENT}. Under the floor the surface is not ` +
        'rendering the figures it claims to, and every other case in this file passes ' +
        'vacuously over whatever is left.',
    ).toBeGreaterThanOrEqual(FLOOR)

    // And the document itself is a real reading rather than an empty string.
    expect(document_.length).toBeGreaterThan(5_000)
  })

  it('renders no figure the committed document does not contain', () => {
    const invented = figures
      .filter((entry) => !document_.includes(entry.figure))
      .map((entry) => {
        const at = surfaceText.indexOf(entry.figure)
        const around =
          at < 0 ? '' : surfaceText.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ')
        return `"${entry.figure}" in ${entry.region} — …${around}…`
      })
    expect(
      invented,
      `a figure on the Benchmarks surface that does not occur in ${SOURCE_DOCUMENT}. ` +
        'Every figure here is a transcription of that document: a rounded one is a figure ' +
        'the document does not contain, and so is an invented one.',
    ).toEqual([])
  })

  it("carries the provenance line at the top of the surface, from the module's own export", async () => {
    const seen = await page.evaluate(() => {
      const panel = document.getElementById('s-bench')
      const line = panel?.querySelector('[data-region="bench/prose-provenance"]') ?? null
      const firstCard = panel?.querySelector('.card') ?? null
      return {
        text: (line?.textContent ?? '').trim(),
        // `DOCUMENT_POSITION_FOLLOWING` = 4: the card comes after the line.
        beforeFirstCard:
          line === null || firstCard === null
            ? false
            : (line.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        cards: panel?.querySelectorAll('.card').length ?? 0,
      }
    })

    // UI-SPEC section 4.7 requirement 1 fixes this sentence; `surfaces/bench.ts` holds the
    // one copy of it and the page writes it. Compared against the export rather than
    // against a literal typed here, so this spec is not a second author of it.
    expect(seen.text).toBe(PROVENANCE)
    expect(seen.cards, 'the surface has cards for the line to sit above').toBeGreaterThan(0)
    expect(
      seen.beforeFirstCard,
      'UI-SPEC section 4.7 requirement 1: the provenance line sits at the top of the ' +
        'surface, not in a footnote',
    ).toBe(true)

    // Its three figures are the document's own — the case above covers them along with
    // every other, and this asserts they are actually present rather than trusting it.
    for (const figure of ['2026-08-02', '23.11']) {
      expect(seen.text, `the provenance line names ${figure}`).toContain(figure)
      expect(document_, `${figure} is the document's own`).toContain(figure)
    }
  })

  it('renders both cited groups in the citation treatment, not the live-figure one', async () => {
    const seen = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-neutral-700)'
      document.body.append(probe)
      const citation = getComputedStyle(probe).color
      probe.remove()

      const colourOf = (selector: string): string | null => {
        const el = document.querySelector(selector)
        return el === null ? null : getComputedStyle(el).color
      }
      return {
        citation,
        speedup: colourOf('[data-region="bench/speedup"]'),
        overhead: colourOf('[data-region="bench/overhead"]'),
        // A live reading on another surface, for the contrast. If these two ever agree the
        // visual half of UI-SPEC section 0's three-classes split has stopped existing.
        reading: colourOf('[data-region="colouring/best-n"]'),
      }
    })

    expect(seen.speedup, 'bench/speedup renders in --color-neutral-700').toBe(seen.citation)
    expect(seen.overhead, 'bench/overhead renders in --color-neutral-700').toBe(seen.citation)
    expect(
      seen.reading,
      'a cited figure and a live reading must be distinguishable without reading the ' +
        'label beside them — UI-SPEC section 4.7 requirement 2',
    ).not.toBe(seen.citation)
  })

  it('has no run control, and no seventh text view', async () => {
    const seen = await page.evaluate(() => ({
      primary: document.querySelectorAll('#s-bench .btn-primary').length,
      buttons: document.querySelectorAll('#s-bench button').length,
      textViews: document.querySelectorAll('#s-bench .text-view').length,
      // The floor under the two zeros above: a selector that has stopped matching anything
      // would report a clean zero on every surface.
      primaryElsewhere: document.querySelectorAll('#s-colouring .btn-primary').length,
      textViewsElsewhere: document.querySelectorAll('#s-colouring .text-view').length,
    }))

    // UI-SPEC section 11 gives this surface no primary CTA: it reads nothing and runs
    // nothing, so `demo-liveness.e2e.test.ts` reports it in P5's skipped list by name.
    expect(seen.primary, '#s-bench holds no .btn-primary').toBe(0)
    expect(seen.buttons, '#s-bench holds no button at all').toBe(0)
    // UI-SPEC section 2.2 lists six text views and this surface is not among them. Asserted
    // rather than left as an absence, because an absent seventh `<pre class="text-view">`
    // otherwise looks like the thing somebody forgot.
    expect(seen.textViews, 'Benchmarks has no text view, deliberately').toBe(0)
    expect(seen.primaryElsewhere, 'the .btn-primary selector still matches').toBeGreaterThan(0)
    expect(seen.textViewsElsewhere, 'the .text-view selector still matches').toBeGreaterThan(0)
  })

  it('links a perf report that resolves from the dev server', async () => {
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
        .filter((a) => a.getAttribute('href')?.includes('perf/') === true)
        .map((a) => ({ raw: a.getAttribute('href') ?? '', resolved: a.href })),
    )
    // Both the footer's and the Benchmarks surface's own.
    expect(hrefs.length, 'the page links the perf report').toBeGreaterThanOrEqual(2)

    for (const link of hrefs) {
      const probe = await context.newPage()
      const response = await probe.goto(link.resolved)
      expect(
        response?.status(),
        `${link.raw} resolved to ${link.resolved} and the dev server answered ` +
          `${String(response?.status())}. Until Plan 27-09 this link pointed at a directory ` +
          'that existed in neither the dev server nor the bundle.',
      ).toBe(200)
      expect(await probe.content()).toContain('Real parallel speedup')
      await probe.close()
    }
  }, 120_000)
})
