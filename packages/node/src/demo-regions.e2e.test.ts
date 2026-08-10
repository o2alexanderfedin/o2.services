import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DIGIT,
  FIGURE_KINDS,
  REGIONS,
  UI_SPEC_TALLY,
  WIRED_SURFACES,
} from '../../browser/src/demo-regions.ts'
import type { Region, SurfaceId } from '../../browser/src/demo-regions.ts'

/**
 * The anti-placeholder guard — UI-SPEC section 9's P1, P2, P3, P4, P6, P7 and P8.
 *
 * The rule it exists to make checkable: **every figure comes from a `TabApi` reading, or is
 * a named absence. Never a default, never a surviving placeholder, never a value the page
 * computed a second opinion about.**
 *
 * It imports `REGIONS` from `packages/browser/src/demo-regions.ts` — the same definition the
 * page imports, by relative path, which is the whole reason that catalogue lives in `src/`
 * rather than in `demo/`. Two consequences worth stating: the guard's expectations are the
 * *committed catalogue* and never the DOM's own attributes, and `demo/` is outside every
 * vitest project's include glob so a catalogue there could not be imported here at all.
 *
 * ## Why P3 is arranged the way it is
 *
 * UI-SPEC section 9 writes P3 as *"every `data-kind="reading"` region's trimmed text equals
 * its `data-absence`"*. **That property cannot fail.** `render.ts`'s `paintAbsence` writes
 * the sentence into `textContent` and mirrors it onto `data-absence` in the same call — it
 * must, because a region has three different absence sentences for three different states —
 * so the comparison is true by construction. Here the element is compared against
 * `REGIONS[id].absence.stopped`, from the catalogue. That is the only arrangement in which
 * P3 is a measurement rather than a restatement.
 *
 * ## What this file does NOT hold, and why
 *
 * **P5 is not here.** It is the liveness property — *after a real two-tab run the colouring
 * regions no longer equal their absence text* — and it is the one property that cannot be
 * green before a screen exists. It lands in Plan 27-04, quantified over every surface that
 * has a primary run control, so that pi and bring-your-own inherit it unwritten.
 *
 * That absence matters more than it looks: **P2, P3 and P4 are all satisfiable by a page
 * that renders nothing.** A page with no figures at all passes every property in this file.
 * A guard that can only fail in one direction is half a guard, and P5 is the other half.
 *
 * **P9 is not here either** — every figure on the Benchmarks surface occurring verbatim in
 * `docs/perf/prime-and-pi-benchmarks.md`. That surface carries no figure yet; Plan 27-09
 * transcribes them and owns the property.
 *
 * ## The switch
 *
 * P1's second half — *every catalogue entry resolves to exactly one element* — is scoped to
 * `WIRED_SURFACES`, which starts at `['session']`. A surface's plan appends one line to that
 * array, which is a greppable admission that it has arrived and turns this half on for all
 * of its regions at once. A surface therefore cannot half-land: it is either absent from the
 * list and unchecked, or in it and checked whole.
 *
 * P6, P7 and P8 are written **generically and now** — quantified over region id suffix and
 * over a named field set rather than over a list of surfaces. They are conditional on
 * population, so they are vacuously true today, and they will be true of pi, bring-your-own
 * and fabric-state the moment those land with no edit to this file. That is the difference
 * between a guard written before the screens and a guard written about them.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * The page-side hook P8 needs, named here so a surface cannot populate an attestation region
 * without also making P8 real.
 *
 * P8 compares a rendered attestation against **a fresh reading taken in the same page**, and
 * there is no `TabApi` accessor for *the last run's receipt* — a run returns it once. So the
 * plan that lands the first attestation region publishes the reading it rendered under this
 * name, and P8 goes from vacuous to live with no edit here. Until then P8 asserts its own
 * precondition: a populated attestation region with no hook is a failure naming this string.
 */
const ATTESTATION_HOOK = '__o2LastAttestation'

/** What P6 quantifies over: field names, not surfaces. UI-SPEC section 9's P6 row names these four. */
const P6_FIELDS: readonly string[] = ['n', 'verificationMultiplier', 'estimate', 'totalBytes']

/** UI-SPEC section 5.2's two sentences. A withheld count may never appear without one of them. */
const EGRESS_SENTENCES: readonly string[] = [
  'registered no sovereign data',
  'They were not sent anywhere.',
]

interface DomRegion {
  readonly id: string
  readonly kind: string | null
  readonly source: string | null
  readonly text: string
  readonly outer: string
}

interface UndeclaredText {
  readonly text: string
  readonly outer: string
}

interface PageSnapshot {
  readonly regions: readonly DomRegion[]
  readonly undeclared: readonly UndeclaredText[]
  readonly o2Keys: readonly string[]
  readonly barVisible: boolean
  readonly attestationHook: string | null
}

let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let baseUrl: string
let snapshot: PageSnapshot

const catalogue: ReadonlyMap<string, Region> = new Map(REGIONS.map((r) => [r.id, r]))
const figures: readonly Region[] = REGIONS.filter((r) => FIGURE_KINDS.includes(r.kind))

/** `TabApi.runColouring().n` -> `runColouring`. `null` when the string is not of that form. */
function methodOf(source: string | null): string | null {
  if (source === null) return null
  const match = /^TabApi\.([A-Za-z][A-Za-z0-9]*)\(/.exec(source)
  return match?.[1] ?? null
}

/** Every sentence the catalogue holds for a region. A populated region equals none of them. */
function absenceSentences(region: Region): readonly string[] {
  const absence = region.absence
  if (absence === undefined) return []
  const out = [absence.initial, absence.stopped]
  if (absence.unavailable !== undefined) out.push(absence.unavailable)
  return out
}

function isPopulated(region: Region, dom: DomRegion): boolean {
  if (dom.text === '') return false
  return !absenceSentences(region).includes(dom.text)
}

/** The one text view declared for a surface, or `undefined` while that surface has none. */
function textViewOf(surface: SurfaceId): Region | undefined {
  return REGIONS.find((r) => r.surface === surface && r.kind === 'text-view')
}

describe('the catalogue checks itself, with no browser', () => {
  it('has unique ids, each prefixed by its own surface', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const region of REGIONS) {
      if (seen.has(region.id)) duplicates.push(region.id)
      seen.add(region.id)
    }
    expect(duplicates, 'a region id appears twice, so one entry silently shadows the other').toEqual([])

    const malformed = REGIONS.filter(
      (r) => !new RegExp(`^${r.surface}/[a-z0-9-]+$`).test(r.id),
    ).map((r) => `${r.id} (surface ${r.surface})`)
    expect(malformed, 'a region id must be <surface>/<field> and its prefix must be its surface').toEqual([])
  })

  it("counts 91 figure regions, and the per-surface split matches UI-SPEC's own tally", () => {
    expect(figures.length).toBe(UI_SPEC_TALLY.total)

    const bySurface: Record<string, number> = {}
    for (const region of figures) bySurface[region.surface] = (bySurface[region.surface] ?? 0) + 1
    // Reported, never reconciled: UI-SPEC section 4's tally is a claim about itself and this
    // is the measurement of it. A disagreement is a finding about the document.
    expect(bySurface).toEqual(UI_SPEC_TALLY.bySurface)
  })

  it("splits 74 reading / 6 constant / 3 cited / 8 control, as UI-SPEC section 4 states", () => {
    const byKind: Record<string, number> = {}
    for (const region of figures) byKind[region.kind] = (byKind[region.kind] ?? 0) + 1
    expect(byKind).toEqual(UI_SPEC_TALLY.byKind)
  })

  it('gives every reading an initial and a stopped sentence, and nothing else an absence', () => {
    // The bar's readings are the stated exception: `activity() === null` removes the element,
    // so their absence is the element not being there — UI-SPEC section 4.1.
    const missing = REGIONS.filter(
      (r) =>
        r.kind === 'reading' &&
        r.absenceMode === undefined &&
        (r.absence === undefined || r.absence.initial === '' || r.absence.stopped === ''),
    ).map((r) => r.id)
    expect(missing, 'a reading with no named absence renders a blank, which is what this phase exists to remove').toEqual([])

    const stray = REGIONS.filter((r) => r.absence !== undefined && r.kind !== 'reading').map((r) => r.id)
    expect(stray, 'only a reading has absence copy; a control or a constant is always present').toEqual([])

    const barWithAbsence = REGIONS.filter(
      (r) => r.absenceMode === 'element-removed' && r.absence !== undefined,
    ).map((r) => r.id)
    expect(barWithAbsence, 'the bar has no absence copy: the element\'s existence IS the reading').toEqual([])
  })

  it('holds no digit in any absence sentence, and ends each one with a full stop', () => {
    const defects: string[] = []
    for (const region of REGIONS) {
      for (const sentence of absenceSentences(region)) {
        if (DIGIT.test(sentence)) defects.push(`${region.id}: digit in "${sentence}"`)
        if (!sentence.endsWith('.')) defects.push(`${region.id}: not a sentence — "${sentence}"`)
      }
    }
    // Digit-free is what makes "a figure region reads as a number" mechanically detectable;
    // the full stop is UI-SPEC's definition of a named absence as a complete sentence.
    expect(defects).toEqual([])
  })

  it('names, on every reading, a method the TabApi interface actually declares', () => {
    // Parsed from the interface itself rather than from a list kept here — a list would be a
    // second copy of `TabApi`'s surface and would go stale the first time a method is renamed.
    const source = readFileSync(join(ROOT, 'packages/browser/src/tab-api.ts'), 'utf8')
    const body = /export interface TabApi \{\n([\s\S]*?)\n\}\n/.exec(source)?.[1]
    expect(body, 'could not find the TabApi interface body — this parse is the check, so its failure is a failure').toBeDefined()
    const declared = new Set<string>()
    for (const match of (body ?? '').matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\(/gm)) {
      const name = match[1]
      if (name !== undefined) declared.add(name)
    }
    expect(declared.size).toBeGreaterThan(20)

    const bad: string[] = []
    for (const region of REGIONS) {
      if (region.kind !== 'reading') continue
      const method = methodOf(region.source)
      if (method === null) {
        bad.push(`${region.id}: source does not begin TabApi.<method>( — "${region.source}"`)
        continue
      }
      const known = declared.has(method)
      if (region.permanentlyUnavailable === undefined && !known) {
        bad.push(`${region.id}: TabApi has no method "${method}"`)
      }
      if (region.permanentlyUnavailable !== undefined && known) {
        // The inverted arm, at the type level. See the browser-side P4 for the live one.
        bad.push(
          `${region.id} is declared permanently unavailable and yet TabApi DOES declare "${method}" — the dispatch path this surface was told it does not have now exists, so the surface must be replanned`,
        )
      }
    }
    expect(bad).toEqual([])
  })

  it('resolves every constant and every citation to something that exists', () => {
    const bad: string[] = []
    for (const region of REGIONS) {
      if (region.kind !== 'constant' && region.kind !== 'cited') continue
      if (region.source.startsWith('@o2/')) continue
      // A published mathematical value has no committed path, and UI-SPEC section 0's
      // `cited` row admits one explicitly beside a committed measurement.
      if (region.kind === 'cited' && region.source.startsWith('published ')) continue
      const path = /^((?:docs|packages|scripts|tools)\/[^\s]+\.(?:md|ts))/.exec(region.source)?.[1]
      if (path === undefined) {
        bad.push(`${region.id}: source names neither an @o2 export nor a committed path — "${region.source}"`)
        continue
      }
      if (!existsSync(join(ROOT, path))) bad.push(`${region.id}: "${path}" is not committed`)
    }
    expect(bad).toEqual([])
  })

  it('starts WIRED_SURFACES at the one surface this plan wires', () => {
    // The forcing function. Every entry must name a surface that exists in the catalogue, and
    // this assertion is what a later plan edits when it appends its own line.
    for (const surface of WIRED_SURFACES) {
      expect(REGIONS.some((r) => r.surface === surface)).toBe(true)
    }
    expect(WIRED_SURFACES.length).toBeGreaterThan(0)
  })
})

describe('the page, with the fabric stopped', () => {
  beforeAll(async () => {
    // No relay and no node. `/bootstrap.json` 404s on a plain dev server exactly as it does
    // on a static host, so `discoverRelays()` reports `source: 'none'`, `#join` stays
    // disabled and `activity()` is null — which is the state every property below is about.
    // A `FabricNode` relay is deliberately not started: nothing here dials one, and a relay
    // that nothing dials would be seconds of setup buying no coverage.
    server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
    await server.listen()
    const url = server.resolvedUrls?.local[0]
    if (url === undefined) throw new Error('vite dev server produced no URL')
    baseUrl = url.endsWith('/') ? url : `${url}/`

    browser = await chromium.launch()
    context = await browser.newContext()
    page = await context.newPage()
    page.on('pageerror', (error) => {
      process.stderr.write(`[page error] ${error.message}\n`)
    })

    await page.goto(`${baseUrl}${PAGE}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })
    // BROW-01 has no test-only bypass: a harness consents by pressing the button.
    await page.click('#allow')
    await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
    await page.waitForFunction(
      () => document.getElementById('state')?.dataset['tone'] === 'blocked',
      null,
      { timeout: 30_000 },
    )

    snapshot = await page.evaluate((hookName) => {
      const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-region]')).map(
        (element) => ({
          id: element.getAttribute('data-region') ?? '',
          kind: element.getAttribute('data-kind'),
          source: element.getAttribute('data-source'),
          text: (element.textContent ?? '').trim(),
          outer: element.outerHTML.slice(0, 240),
        }),
      )

      // Every text node under `#main`, with whether any ancestor declares it. The DIGIT
      // filter is applied on the Node side so there is one definition of what a digit is.
      const undeclared: { text: string; outer: string }[] = []
      const main = document.getElementById('main')
      if (main !== null) {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const raw = (node.nodeValue ?? '').trim()
          if (raw === '') continue
          let declared = false
          for (let el = node.parentElement; el !== null; el = el.parentElement) {
            if (el.hasAttribute('data-region')) {
              declared = true
              break
            }
          }
          if (!declared) {
            // The WHOLE text node, untruncated. The first draft of this pushed
            // `raw.slice(0, 160)` and the DIGIT filter then ran over the truncation: the
            // colouring card's second paragraph carries `N = 7824` at about character 230
            // and P2 reported the page clean. Truncation belongs in the failure message and
            // nowhere near the thing being measured.
            undeclared.push({
              text: raw,
              outer: (node.parentElement?.outerHTML ?? '').slice(0, 240),
            })
          }
        }
      }

      const bar = document.getElementById('bar')
      const hook = (window as unknown as Record<string, unknown>)[hookName]
      return {
        regions,
        undeclared,
        o2Keys: Object.keys(window.o2),
        barVisible: bar !== null && !bar.hidden,
        attestationHook: hook === undefined || hook === null ? null : JSON.stringify(hook),
      }
    }, ATTESTATION_HOOK)
  }, 180_000)

  afterAll(async () => {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
  }, 60_000)

  it('P1a — every [data-region] element on the page is in the catalogue', () => {
    const undeclared = snapshot.regions
      .filter((dom) => !catalogue.has(dom.id))
      .map((dom) => `${dom.id === '' ? '(empty data-region)' : dom.id} :: ${dom.outer}`)
    expect(
      undeclared,
      'an element declares a region the catalogue does not hold, so nothing states what it reads or what it says when it has nothing',
    ).toEqual([])
    // A floor: a clean result over an empty set says nothing at all.
    expect(snapshot.regions.length).toBeGreaterThan(0)
  })

  it('P1b — every catalogue entry of a wired surface resolves to exactly one element', () => {
    const counts = new Map<string, number>()
    for (const dom of snapshot.regions) counts.set(dom.id, (counts.get(dom.id) ?? 0) + 1)

    const problems: string[] = []
    for (const region of REGIONS) {
      if (!WIRED_SURFACES.includes(region.surface)) continue
      // UI-SPEC section 4.1: with no node the bar is not rendered at all, so its regions
      // having no element IS their reading.
      if (region.absenceMode === 'element-removed' && !snapshot.barVisible) continue
      const found = counts.get(region.id) ?? 0
      if (found !== 1) {
        problems.push(
          `${region.id} (${region.kind}) resolves to ${found} element(s); a wired surface's region is exactly one`,
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('P2 — no undeclared digit is on screen inside #main', () => {
    // DIGIT is applied to the full text node; the truncation is for the message only, and
    // it prints WHICH number, because a guard whose message does not say which one costs
    // more to act on than it saves.
    const offenders = snapshot.undeclared
      .filter((entry) => DIGIT.test(entry.text))
      .map((entry) => {
        const at = entry.text.search(DIGIT)
        const around = entry.text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')
        return `digit at char ${at}: …${around}…  in  ${entry.outer}`
      })
    expect(
      offenders,
      'a number on screen with no data-region ancestor: it is neither a reading, nor a constant, nor a citation, nor declared prose',
    ).toEqual([])
  })

  it("P3 — every reading region reads the catalogue's sentence for this state, digit-free", () => {
    const problems: string[] = []
    for (const dom of snapshot.regions) {
      const region = catalogue.get(dom.id)
      if (region === undefined) continue // P1a's failure, not this one's
      if (region.kind !== 'reading') continue
      if (region.absenceMode === 'element-removed') continue

      // From the CATALOGUE. Never `dom.getAttribute('data-absence')`: the writer sets the
      // attribute and the text in one call, so that comparison could not fail.
      const expected =
        region.permanentlyUnavailable === undefined
          ? region.absence?.stopped
          : region.absence?.unavailable
      if (expected === undefined) {
        problems.push(`${region.id}: the catalogue holds no sentence for this state`)
        continue
      }
      if (dom.text !== expected) {
        problems.push(`${region.id}: on screen "${dom.text}" — the catalogue says "${expected}"`)
      }
      if (DIGIT.test(dom.text)) {
        problems.push(`${region.id}: a reading region with no reading carries a digit — "${dom.text}"`)
      }
    }
    expect(problems).toEqual([])
  })

  it('P4a — every ordinary reading names a method window.o2 actually has', () => {
    const keys = new Set(snapshot.o2Keys)
    expect(keys.size).toBeGreaterThan(20)

    const problems: string[] = []
    for (const dom of snapshot.regions) {
      const region = catalogue.get(dom.id)
      if (region === undefined || region.kind !== 'reading') continue
      if (region.permanentlyUnavailable !== undefined) continue
      const method = methodOf(dom.source)
      if (method === null) {
        problems.push(`${dom.id}: data-source does not begin TabApi.<method>( — "${dom.source}"`)
        continue
      }
      if (!keys.has(method)) {
        problems.push(
          `${dom.id}: data-source names TabApi.${method}(), and window.o2 has no such method — this region would have been discovered as a timeout inside page.evaluate`,
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('P4b — every permanently-unavailable reading names a method window.o2 does NOT have', () => {
    const keys = new Set(snapshot.o2Keys)
    const problems: string[] = []

    // Quantified over the CATALOGUE rather than over elements on the page. These surfaces
    // are not wired, so an element-scoped check would be vacuous — and the whole point of
    // the flag is that it turns "this surface cannot run" into a claim that is checked
    // whether or not anybody has drawn the surface yet.
    for (const region of REGIONS) {
      if (region.permanentlyUnavailable === undefined) continue
      const method = methodOf(region.source)
      if (method === null) {
        problems.push(`${region.id}: source does not begin TabApi.<method>( — "${region.source}"`)
        continue
      }
      if (keys.has(method)) {
        problems.push(
          `${region.id} names TabApi.${method}(): the dispatch path this surface was told it does not have now exists — the surface must be replanned`,
        )
      }
    }
    for (const dom of snapshot.regions) {
      const region = catalogue.get(dom.id)
      if (region?.permanentlyUnavailable === undefined) continue
      const method = methodOf(dom.source)
      if (method !== null && keys.has(method)) {
        problems.push(
          `${dom.id}'s data-source names TabApi.${method}(): the dispatch path this surface was told it does not have now exists — the surface must be replanned`,
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('P6 — a populated figure also occurs in its own surface text view', () => {
    // Quantified over the named field set and over the region's own surface. No surface is
    // named in this body, so pi, bring-your-own and fabric-state inherit it unwritten.
    const problems: string[] = []
    for (const dom of snapshot.regions) {
      const region = catalogue.get(dom.id)
      if (region === undefined || region.kind !== 'reading') continue
      if (!P6_FIELDS.some((field) => region.source.endsWith(`.${field}`))) continue
      if (!isPopulated(region, dom)) continue

      const view = textViewOf(region.surface)
      if (view === undefined) {
        problems.push(`${region.id} is populated and its surface declares no text view to render it twice`)
        continue
      }
      const viewText = snapshot.regions.find((other) => other.id === view.id)?.text
      if (viewText === undefined) {
        problems.push(`${region.id} is populated and its text view ${view.id} is not on the page`)
        continue
      }
      if (!viewText.includes(dom.text)) {
        problems.push(
          `${region.id} renders "${dom.text}" and ${view.id} does not contain that string — one value, two formatters`,
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('P7 — a withheld count never appears without the sentence that explains it', () => {
    // Quantified over id suffix. UI-SPEC section 5.2: the count and its sentence are ONE
    // region and ONE template function, because the bare figure reads as a sovereignty proof.
    const problems: string[] = []
    for (const dom of snapshot.regions) {
      const region = catalogue.get(dom.id)
      if (region === undefined) continue
      if (!region.id.endsWith('/egress') && !region.id.endsWith('-withheld')) continue
      if (!isPopulated(region, dom)) continue
      if (!/withheld/i.test(dom.text) || !DIGIT.test(dom.text)) continue
      if (!EGRESS_SENTENCES.some((sentence) => dom.text.includes(sentence))) {
        problems.push(
          `${region.id} shows a withheld count with neither "${EGRESS_SENTENCES[0]}" nor "${EGRESS_SENTENCES[1]}" beside it — the figure alone is a lie by omission`,
        )
      }
    }
    expect(problems).toEqual([])
  })

  it("P8 — an attestation region carries the fabric's own words and no sentence of the page's", () => {
    // Quantified over id suffix, and it asserts its own precondition: a populated attestation
    // region with no page-side reading published makes this red rather than vacuous.
    const populated = snapshot.regions.filter((dom) => {
      const region = catalogue.get(dom.id)
      if (region === undefined) return false
      if (!region.id.endsWith('/attestation') && !region.id.endsWith('/attestation-description')) {
        return false
      }
      return isPopulated(region, dom)
    })

    if (populated.length === 0) {
      // Vacuous, and said out loud rather than reported as a pass about nothing.
      expect(populated).toEqual([])
      return
    }

    expect(
      snapshot.attestationHook,
      `an attestation region is populated and the page publishes no window.${ATTESTATION_HOOK}; P8 compares a rendered receipt against a fresh reading taken in the same page, and without one it would be comparing the page against itself`,
    ).not.toBeNull()

    const reading = JSON.parse(snapshot.attestationHook ?? 'null') as
      | { description?: string; reason?: string }
      | null
    const problems: string[] = []
    for (const dom of populated) {
      const receipt = reading?.description
      const absence = reading?.reason
      const ok =
        (receipt !== undefined && dom.text === receipt) ||
        (absence !== undefined && dom.text.includes(absence))
      if (!ok) {
        problems.push(
          `${dom.id} reads "${dom.text}", which is neither attestation.description verbatim nor a block containing attestation.reason — the page has composed a sentence of its own`,
        )
      }
    }
    expect(problems).toEqual([])
  })
})
