import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REGIONS, WIRED_SURFACES } from '../../browser/src/demo-regions.ts'
import type { Region, SurfaceId } from '../../browser/src/demo-regions.ts'
import {
  ATTESTATION_HOOK,
  absenceSentences,
  p6,
  p7,
  p8,
} from './demo-region-properties.ts'
import type { DomRegion } from './demo-region-properties.ts'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * **P5 — liveness.** UI-SPEC section 9, and the property the rest of the guard cannot supply.
 *
 * `demo-regions.e2e.test.ts` says it at the top of its own header: *P2, P3 and P4 are all
 * satisfiable by a page that renders nothing.* A page with no figures at all passes every
 * property in that file. This is the other direction — after a **real two-tab run**, a surface
 * with a run control must no longer read as absent — and without it the anti-placeholder guard
 * can only fail one way, which is half a guard.
 *
 * ## It is written over run controls DISCOVERED FROM THE DOM
 *
 * Not over a list of surfaces and not over a hard-coded button id. For every surface named in
 * `WIRED_SURFACES` it asks the page for `#s-<surface> .btn-primary` and drives whatever it
 * finds. At this plan's landing that discovers exactly one control on exactly one surface, and
 * the acceptance criterion for the next plan is that the observed count rises to two **with no
 * edit to this file**. If π's arrival needs an edit here, that is a defect in this property and
 * not in π.
 *
 * **Corrected 2026-08-10 by Plan 27-05, and the correction is the interesting part.** The
 * paragraph above was right about discovery and wrong about driving. When π landed the census
 * did rise to two with no edit to this file — `[P5] exercised … colouring, pi` — and the run
 * then failed at `page.click('#s-pi .btn-primary')` with `element is not visible`, because
 * `nav.ts` hides every panel but the selected one. The property had been driving exactly one
 * surface and that surface was the page's default, so *discovered from the DOM* had never been
 * tested against a surface anywhere else. It drives its own navigation now, through the tab a
 * visitor presses. This was a defect in P5, exactly as Plan 27-05's acceptance criterion said
 * it would be if one appeared, and it is recorded rather than smoothed over.
 *
 * A surface with no run control — `session` today, `fabric` and `bench` later — is skipped, and
 * **the skip is reported by name** in the output. A property that quietly covers nothing is
 * exactly the failure mode P5 exists to close, one level up: {@link exercised} asserts that at
 * least one surface was actually driven, so a refactor that stops finding run controls reddens
 * instead of passing about nothing.
 *
 * ## The expectation is the committed catalogue, never the element
 *
 * Compared against `REGIONS[id].absence`, imported from `../../browser/src/demo-regions.ts`.
 * Never against the element's own `data-absence`: `render.ts`'s `paintAbsence` writes the
 * sentence into `textContent` and mirrors it onto that attribute in one call, so comparing the
 * two would compare a string with itself. Plan 27-03 measured that difference rather than
 * arguing it — UI-SPEC's own formulation of P3 passed at exit 0 under a plant this arrangement
 * caught at exit 1.
 *
 * ## Two arms, and the second is the one with teeth
 *
 * - **P5a** — at least one `reading` region on a driven surface differs from *every* sentence
 *   its catalogue entry holds. This is the "the page rendered something" arm.
 * - **P5b** — given P5a, no `reading` region on that surface still equals its `initial` or its
 *   `stopped` sentence. After a run that produced readings, *the search has not been run* and
 *   *this tab's node is stopped* are both untrue, and a region saying either is a survivor. A
 *   region legitimately without a reading must say so in its own `unavailable` words.
 *
 *   **The exemption, stated rather than left implicit:** a region whose catalogue entry holds
 *   no `unavailable` arm at all is allowed to fall back, because the catalogue itself admits
 *   there is no other sentence for it.
 *
 *   **How large that exemption is, recomputed from `REGIONS` on 2026-08-10 — and it is not
 *   two.** This paragraph said *"Two colouring regions … C15 and C17"* from the day P5b was
 *   written until now. Counted rather than remembered, **eight** colouring reading regions
 *   hold no `unavailable` arm: C6, C7 and C8 (`rung-300`, `rung-400`, `rung-500` — C9 has an
 *   arm of its own), C15 `attestation`, C17 `egress`, and C18, C19 and C20
 *   (`verify-verdict`, `verify-n`, `verify-triples`). Only **two of the eight** — C15 and
 *   C17 — are covered by name in the specific block below, which is the other half of what
 *   the old sentence got wrong: it read as though the exempt set and the named set were the
 *   same five-region-wide thing. Across the three surfaces P5 drives today the exempt set is
 *   **24** of their reading regions, and **44** catalogue-wide once `fabric`'s 16 and
 *   `session`/`bar`'s 2 each are included.
 *
 *   **It grew 2 → 8 → 24 with nothing going red**, because no assertion anywhere read its
 *   size. That is now closed one level up rather than here:
 *   `demo-regions.e2e.test.ts`'s catalogue self-check holds a ceiling on it, so the next
 *   region added without an `unavailable` arm reddens a case instead of silently widening
 *   this exemption. The ceiling lives there and not in this file because it is a property of
 *   the catalogue, and this file cannot reach one without paying for a two-tab browser
 *   fixture first.
 *
 * ## The fixture is `colouring-demo.e2e.test.ts`'s, with one difference
 *
 * Two isolated `BrowserContext`s so the tabs share no IndexedDB, no peer identity and no libp2p
 * state, against a real in-process `FabricNode` relay. **The relay is the in-process node
 * rather than `bin/seed.ts`**, and the reason is a reading rather than a preference: `seed.ts`
 * is a CLI that also serves `/bootstrap.json` and its own static copy of the page, which would
 * put a second page origin and a second discovery route into a fixture whose subject is neither.
 * `FabricNode.start` gives the same Circuit Relay v2 peer with none of that, and it is what
 * every other two-tab spec here uses.
 *
 * The difference from `colouring-demo`: the tabs are started **through the page's own `#join`
 * button**, reached by `?relay=`, rather than through `window.o2.start` from the harness. That
 * matters here specifically — `findPeers` is installed by that handler and nothing else, so
 * `#peers` only becomes a live reading down that path, and `2 node(s) computing` is the
 * precondition this file asserts before dispatching anything.
 *
 * One harness intervention remains and is named: tab A dials tab B's WebRTC address once, as
 * `colouring-demo.e2e.test.ts` does. Rendezvous over the relay's reservation store would get
 * there on its own timetable; the dial makes *when* deterministic without changing *what*.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

/** One surface's run-control census, taken from the page rather than from a list. */
interface SurfaceCensus {
  readonly surface: string
  readonly hasPanel: boolean
  readonly primaryControls: number
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const tabs: Tab[] = []

/** Surfaces this run actually drove, and the ones it skipped, both reported by name. */
let census: readonly SurfaceCensus[] = []
let exercised: readonly string[] = []
let skipped: readonly string[] = []
/** Every `[data-region]` inside every driven panel, after everything was driven. */
let driven: readonly DomRegion[] = []
let attestationHook: string | null = null

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((r) => [r.id, r]))

/** Every `[data-region]` inside one surface's panel, as plain data. */
async function readPanel(page: Page, surface: string): Promise<DomRegion[]> {
  return page.evaluate(
    (name) =>
      Array.from(document.querySelectorAll(`#s-${name} [data-region]`)).map((element) => ({
        id: element.getAttribute('data-region') ?? '',
        kind: element.getAttribute('data-kind'),
        source: element.getAttribute('data-source'),
        text: (element.textContent ?? '').trim(),
        outer: element.outerHTML.slice(0, 240),
      })),
    surface,
  )
}

/**
 * Everything the panel currently says, in one string. Used to notice that a control did work.
 *
 * The separators are printable on purpose. A NUL would be the obvious choice for a value that
 * cannot occur in the text, and `vocabulary.node.test.ts` refuses a source file containing one:
 * a file with a NUL byte reads as binary to the repository scan and is skipped whole, which is
 * an exemption with no entry and no reason. It caught this line.
 */
function digestOf(regions: readonly DomRegion[]): string {
  return regions.map((region) => `${region.id}|${region.text}`).join('\n')
}

async function openTab(name: string): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  // The relay arrives through the page's own `?relay=` query string — the thing a visitor
  // pastes. Nothing else here is supplied by the harness.
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor clicks
  // the button, and it joins by pressing the button a visitor presses.
  await page.click('#allow')
  await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    () => document.getElementById('join')?.hasAttribute('disabled') === false,
    null,
    { timeout: 60_000 },
  )
  await page.click('#join')
  await page.waitForFunction(
    () => document.getElementById('state')?.dataset['tone'] === 'live',
    null,
    { timeout: 120_000 },
  )
  const peerId = await page.evaluate(() => window.o2.addresses().peerId)
  return { name, context, page, peerId }
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-demo-liveness-'))
  // DET-03: the demo's own anchor, matching what `bin/seed.ts` pins with no flags. The tabs
  // run the demo's signed colouring kernel, so the authority that vouches for it is the one
  // that belongs in the relay too.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
  tabs.push(await openTab('a'))
  tabs.push(await openTab('b'))
}, 420_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

describe('P5 — after a real two-tab run, a surface with a run control no longer reads as absent', () => {
  /**
   * The fixture is what it claims to be, checked before anything is read off it.
   *
   * A lone tab runs every cube once, so placement has one node per cube and the attestation
   * regions have nothing about agreement to say. The whole reason for the second tab is that
   * those two regions carry a reading a solo run could not produce, and asserting the count
   * **on the page** rather than through `window.o2` is what makes it this page's reading.
   */
  it('has two tabs computing, on the page, before anything is dispatched', async () => {
    const [a, b] = tabs as [Tab, Tab]
    expect(a.peerId).not.toBe(b.peerId)

    const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(120_000))
    const dialed = await a.page.evaluate(async (addr) => window.o2.dial(addr), bAddrs[0]!)
    expect(dialed).toBe(b.peerId)

    await a.page.waitForFunction(
      () => (document.getElementById('peers')?.textContent ?? '').includes('2 node(s) computing'),
      null,
      { timeout: 120_000 },
    )
    expect(await a.page.textContent('#peers')).toContain('2 node(s) computing')
  }, 300_000)

  /**
   * The property itself. Everything above is fixture; this is the reading.
   */
  it('drives every run control it can find, names the surfaces it skipped, and leaves no region absent', async () => {
    const [a] = tabs as [Tab]

    // ---- discovery, from the page ----------------------------------------------------
    census = await a.page.evaluate(
      (surfaces) =>
        surfaces.map((surface) => {
          const panel = document.getElementById(`s-${surface}`)
          return {
            surface,
            hasPanel: panel !== null,
            primaryControls: panel === null ? 0 : panel.querySelectorAll('.btn-primary').length,
          }
        }),
      [...WIRED_SURFACES] as string[],
    )

    exercised = census.filter((entry) => entry.primaryControls > 0).map((entry) => entry.surface)
    skipped = census.filter((entry) => entry.primaryControls === 0).map((entry) => entry.surface)
    process.stderr.write(
      `[P5] wired surfaces: ${WIRED_SURFACES.join(', ')}\n` +
        `[P5] exercised (a primary run control was found and driven): ${exercised.join(', ') || '(none)'}\n` +
        `[P5] skipped (no primary run control on the surface): ${skipped.join(', ') || '(none)'}\n`,
    )

    // A surface offering two primary controls makes "the run control" ambiguous, and a
    // property that guesses is a property that can guess wrong.
    for (const entry of census) {
      expect(
        entry.primaryControls,
        `${entry.surface} offers ${entry.primaryControls} primary controls; P5 drives one or none`,
      ).toBeLessThanOrEqual(1)
    }

    // The floor. A refactor that stops finding run controls must redden here rather than
    // report a clean pass over nothing — which is the failure mode P5 itself exists to close.
    expect(exercised.length, 'P5 drove no surface at all, so every assertion below is vacuous').toBeGreaterThanOrEqual(1)

    // ---- drive ------------------------------------------------------------------------
    const collected: DomRegion[] = []
    for (const surface of exercised) {
      // **A surface has to be on screen before it can be driven, and this property did not
      // put it there.** Measured on 2026-08-10, the moment π became the second surface: the
      // census above rose from one to two with no edit to this file, exactly as its header
      // promised — `[P5] exercised … colouring, pi` — and then the click below timed out at
      // 30 s with `element is not visible`, because `nav.ts` hides every panel but the
      // selected one and the default selection is `colouring`. So this property had been
      // *discovering* run controls generically and *driving* only the surface the page
      // happens to open on; it would have failed on the second surface whichever one that
      // was. That is a defect in P5 and it is fixed here rather than worked around in the
      // surface it could not reach.
      //
      // The fix is the visitor's own path — press the tab. `nav.ts` writes `location.hash`
      // and renders synchronously from it, so nothing here sets the hash, reaches into that
      // module, or removes a `hidden` attribute by hand.
      const tab = `#nav-${surface}`
      if ((await a.page.locator(tab).count()) > 0) await a.page.click(tab)
      await a.page.waitForSelector(`#s-${surface}`, { state: 'visible', timeout: 30_000 })

      const panelBefore = await readPanel(a.page, surface)
      const viewBefore = digestOf(panelBefore)

      // **Every text view on the surface, not the first one — corrected 2026-08-17.** This read
      // `panel?.querySelector('.text-view')` and took whichever came first in the DOM, which
      // was a hidden assumption that a surface has exactly one. Bring-your-own now has two:
      // `#byo-fetch`, written when a module is pulled from a gateway, and `#byo-report`,
      // written by the dispatch. The gateway view is above the report, so the singular
      // selector started watching an element the primary control does not write and this
      // property **timed out at 600 s** rather than reporting anything — the least useful
      // failure it could give, and one that would have been paid again by the next surface to
      // grow a second view.
      //
      // Joined and compared as one string, computed by the same expression on both sides so
      // the before and the after cannot differ for a reason that is not the run. Any view
      // changing is the run having produced a reading, which is what the singular form meant.
      const viewsOf = (name: string): Promise<string> =>
        a.page.evaluate(
          (id) =>
            Array.from(document.getElementById(`s-${id}`)?.querySelectorAll('.text-view') ?? [])
              .map((view) => (view.textContent ?? '').trim())
              .join('\u0000'),
          name,
        )
      const viewsBefore = await viewsOf(surface)

      await a.page.click(`#s-${surface} .btn-primary`)

      // Completion, generically: a surface's text views are written by `applyRender` in the
      // same call that writes the regions, so one of them changing IS the run having produced
      // a reading. The primary control is deliberately NOT the signal — this page's reconciler
      // re-enables it on a one-second tick while the run is still climbing.
      await a.page.waitForFunction(
        (arg) =>
          Array.from(document.getElementById(`s-${arg.surface}`)?.querySelectorAll('.text-view') ?? [])
            .map((view) => (view.textContent ?? '').trim())
            .join('\u0000') !== arg.was,
        { surface, was: viewsBefore },
        { timeout: 600_000 },
      )

      // Then every other control the surface offers, in DOM order. A visitor presses them
      // all, and a region wired only to a secondary control is still a region that must stop
      // reading as absent. On colouring that is `#verify`, which is DEMO-02's whole point.
      const others: string[] = await a.page.evaluate((name) => {
        const panel = document.getElementById(`s-${name}`)
        if (panel === null) return []
        return Array.from(panel.querySelectorAll('button'))
          .filter((button) => !button.classList.contains('btn-primary'))
          .map((button) => button.id)
          .filter((id) => id !== '')
      }, surface)

      for (const id of others) {
        await a.page
          .waitForFunction(
            (buttonId) => document.getElementById(buttonId)?.hasAttribute('disabled') === false,
            id,
            { timeout: 60_000 },
          )
          .catch(() => {
            process.stderr.write(`[P5] ${surface}: #${id} never became enabled; not driven\n`)
          })
        if (await a.page.isDisabled(`#${id}`)) continue
        const before = digestOf(await readPanel(a.page, surface))
        await a.page.click(`#${id}`)
        // A control that changes nothing on its own surface is not this property's business,
        // so the wait is best-effort and the assertions below are what report.
        await a.page
          .waitForFunction(
            (arg) =>
              Array.from(document.querySelectorAll(`#s-${arg.surface} [data-region]`))
                .map(
                  (element) =>
                    `${element.getAttribute('data-region') ?? ''}|${(element.textContent ?? '').trim()}`,
                )
                .join('\n') !== arg.was,
            { surface, was: before },
            { timeout: 60_000 },
          )
          .catch(() => {})
      }

      collected.push(...(await readPanel(a.page, surface)))
    }
    driven = collected
    attestationHook = await a.page.evaluate((hook) => {
      const value = (window as unknown as Record<string, unknown>)[hook]
      return value === undefined || value === null ? null : JSON.stringify(value)
    }, ATTESTATION_HOOK)

    // ---- P5a: the page rendered something ----------------------------------------------
    const readings = driven.filter((dom) => CATALOGUE.get(dom.id)?.kind === 'reading')
    expect(readings.length, 'a driven surface declared no reading regions at all').toBeGreaterThan(0)

    const populated = readings.filter((dom) => {
      const region = CATALOGUE.get(dom.id)
      return region !== undefined && dom.text !== '' && !absenceSentences(region).includes(dom.text)
    })
    process.stderr.write(
      `[P5] ${populated.length} of ${readings.length} reading regions carry a reading after the run\n`,
    )
    expect(
      populated.map((dom) => dom.id),
      'every reading region on a driven surface still equals one of its named absences — a page that renders nothing satisfies P2, P3 and P4, and this is the property that says so',
    ).not.toEqual([])

    // ---- P5b: no survivor ----------------------------------------------------------------
    const survivors: string[] = []
    for (const dom of readings) {
      const region = CATALOGUE.get(dom.id)
      if (region?.absence === undefined) continue
      // **A permanently-unavailable reading cannot be a survivor, and this exemption arrived
      // 2026-08-17 with the first one to sit on a surface P5 drives.** `render.ts` gives such a
      // region its `unavailable` arm in every state by design, so it holds the same sentence
      // before and after a run — and for `primes/per-shard` that sentence is *true* both times:
      // `TabPrimesRun` carries the total and not the shard rows, so there is no reading for it
      // to be waiting on. It is not a page that rendered nothing; it is a page saying which
      // field it does not have.
      //
      // This never arose before because the only permanently-unavailable readings were on the
      // Primes surface under Option B, which had no run control, so P5 skipped the surface
      // whole. Option A gave it one. The pairing that keeps this honest is in
      // `demo-regions.e2e.test.ts`'s P4b: a permanent absence is only allowed while the thing
      // it names really is missing from `TabApi`.
      if (region.permanentlyUnavailable !== undefined) continue
      // The stated exemption: where the catalogue holds no `unavailable` arm there is no
      // other sentence for the page to render, so falling back is not a survivor. **Eight**
      // colouring regions are in that position, not the two this comment claimed until
      // 2026-08-10 (C6, C7, C8, C15, C17, C18, C19, C20 — recounted from `REGIONS`), and
      // exactly two of them, C15 and C17, are asserted by name in the next case. Its size is
      // held by a ceiling in `demo-regions.e2e.test.ts`'s catalogue self-check; see this
      // file's P5b docblock.
      if (region.absence.unavailable === undefined) continue
      if (dom.text === region.absence.initial || dom.text === region.absence.stopped) {
        survivors.push(
          `${dom.id}: on screen "${dom.text}" — that is its ${dom.text === region.absence.initial ? 'pre-run' : 'stopped'} sentence, and this tab has both run and a running node`,
        )
      }
    }
    expect(
      survivors,
      'a reading region survived a real run still saying it had not been run, or that the node is stopped',
    ).toEqual([])
  }, 900_000)

  /**
   * The five regions the liveness claim is specifically about, named because the generic arms
   * above would be satisfied by a surface that populated only its easiest region.
   */
  it('populates the settled rung, the cost, the receipt, the counts and the manifest', () => {
    const named = [
      'colouring/best-n',
      'colouring/verification-multiplier',
      'colouring/attestation',
      'colouring/status-counts',
      'colouring/egress',
    ]
    const problems: string[] = []
    for (const id of named) {
      const region = CATALOGUE.get(id)
      const dom = driven.find((entry) => entry.id === id)
      if (region === undefined || dom === undefined) {
        problems.push(`${id} is not on the driven surface at all`)
        continue
      }
      if (dom.text === '') {
        problems.push(`${id} is empty`)
        continue
      }
      if (absenceSentences(region).includes(dom.text)) {
        problems.push(
          `${id} on screen "${dom.text}" — the run produced a reading and the region still reads as absent`,
        )
      }
    }
    expect(problems).toEqual([])

    // The two controls and the three constants, read off the page rather than derived from the
    // shipped symbols. They are not `reading` regions, so nothing above asserts them — and a
    // figure nobody reads is a figure a summary can only claim.
    process.stderr.write(
      `[P5] arguments and constants on screen: ` +
        ['cubes-arg', 'redundancy-arg', 'budget', 'max-n', 'input-bytes']
          .map((field) => `${field}=${driven.find((d) => d.id === `colouring/${field}`)?.text}`)
          .join(' · ') +
        '\n',
    )
    process.stderr.write(
      `[P5] settled n: ${driven.find((d) => d.id === 'colouring/best-n')?.text}\n` +
        `[P5] verification cost: ${driven.find((d) => d.id === 'colouring/verification-multiplier')?.text}\n` +
        `[P5] attestation: ${driven.find((d) => d.id === 'colouring/attestation')?.text}\n` +
        `[P5] per-cube counts: ${driven.find((d) => d.id === 'colouring/status-counts')?.text}\n` +
        `[P5] egress: ${(driven.find((d) => d.id === 'colouring/egress')?.text ?? '').replace(/\n/g, ' ')}\n` +
        `[P5] verdict: ${driven.find((d) => d.id === 'colouring/verify-verdict')?.text}` +
        ` · triples ${driven.find((d) => d.id === 'colouring/verify-triples')?.text}\n`,
    )
  })

  /**
   * P6, P7 and P8, run **here** against a populated page.
   *
   * They are the same three functions `demo-regions.e2e.test.ts` calls, from
   * `./demo-region-properties.ts`. On that file's page there is no relay and no node, so
   * nothing is ever populated and all three are vacuously true; they were written generically
   * and could not fire. This is where they have something to measure, and each case asserts
   * what it examined rather than only what it found — `examined: 0` and `problems: []` are the
   * same result to `toEqual([])` and are entirely different findings.
   */
  it('P6 measures something now: a populated figure occurs in its own text view', () => {
    const result = p6(driven)
    process.stderr.write(`[P6] examined ${result.examined} populated figures\n`)
    expect(result.problems).toEqual([])
    expect(
      result.examined,
      'P6 examined nothing on a page that has run: it is still vacuous, and the plan that populated these fields did not populate them',
    ).toBeGreaterThan(0)
  })

  it('P7 measures something now: a withheld count never appears without its sentence', () => {
    const result = p7(driven)
    process.stderr.write(`[P7] examined ${result.examined} populated egress regions\n`)
    expect(result.problems).toEqual([])
    expect(
      result.examined,
      'P7 examined nothing on a page that has run: no egress region carries a withheld count, so section 5.2 is unenforced here',
    ).toBeGreaterThan(0)
  })

  it("P8 measures something now: the attestation region is the fabric's own words", () => {
    const result = p8(driven, attestationHook)
    process.stderr.write(
      `[P8] examined ${result.examined} populated attestation regions; hook ${attestationHook === null ? 'ABSENT' : 'present'}\n`,
    )
    expect(result.hookProblem).toBeNull()
    expect(result.problems).toEqual([])
    expect(
      result.examined,
      'P8 examined nothing on a page that has run: no attestation region is populated, so section 5.1 is unenforced here',
    ).toBeGreaterThan(0)
  })
})
