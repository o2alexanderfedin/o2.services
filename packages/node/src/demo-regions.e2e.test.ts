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
import type { Region } from '../../browser/src/demo-regions.ts'
import { ATTESTATION_HOOK, absenceSentences, methodOf, p6, p7, p8 } from './demo-region-properties.ts'
import type { DomRegion } from './demo-region-properties.ts'

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
 *
 * ## Where P6, P7 and P8 actually live now — Plan 27-04
 *
 * Their bodies moved to `./demo-region-properties.ts` and this file calls them. The reason is
 * a fact about **this page** rather than about how they were written: it has no relay and no
 * node, so no region is ever populated here, so all three are vacuously true here **and always
 * will be**. `demo-liveness.e2e.test.ts` drives a real two-tab run and calls the same three
 * functions against a page that carries readings, which is where they have something to
 * measure. One implementation, two harnesses — two copies of a property are two properties
 * that can come to disagree about what they check.
 *
 * The three cases below are kept rather than deleted, and they now say `examined: 0` out loud.
 * A property whose vacuity is asserted is a property nobody can mistake for coverage.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

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

/**
 * The P5b exemption's ceiling — **44**, read out of `REGIONS` on 2026-08-10, not chosen.
 *
 * `demo-liveness.e2e.test.ts`'s P5b skips any reading region whose catalogue entry holds no
 * `unavailable` arm, on the stated ground that the catalogue itself admits there is no other
 * sentence for it. The exemption is sound and its **size was unasserted**: it went from the
 * two regions its docblock named, to eight on colouring alone, to 24 across the three
 * surfaces P5 drives, to 44 catalogue-wide, and **nothing anywhere went red at any step**,
 * because no case read the set's size. Each addition was individually defensible; the
 * aggregate is that 44 of 74 reading regions are outside the one property that says a page
 * which renders nothing is not passing.
 *
 * **Why a ceiling and not an exact set.** An exact id list would also redden when a region
 * *gains* an `unavailable` arm, which is the improvement this is trying to encourage, and it
 * would redden for every unrelated catalogue addition. Growth is the hazard, so growth is
 * what is asserted. The failure message names the surfaces and the ids so the red says which
 * region widened it rather than only that something did.
 *
 * **Why here and not in `demo-liveness.e2e.test.ts`.** This is a property of the catalogue
 * and needs no browser; that file's fixture is at module scope, so a case there could not be
 * reached without starting a relay, a Vite server and two browser contexts first.
 *
 * Raising this number is a decision, not a merge conflict: it means P5b covers less than it
 * did, and the reason belongs beside the raise.
 */
const P5B_EXEMPT_CEILING = 44

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

  it('keeps the P5b exemption under its ceiling, so it cannot widen silently', () => {
    // Exactly P5b's own two `continue`s, in `demo-liveness.e2e.test.ts`: no absence object at
    // all, or an absence with no `unavailable` arm. Recomputed here rather than imported,
    // because importing that file would drag its module-scope browser fixture in with it.
    const exempt = REGIONS.filter(
      (r) => r.kind === 'reading' && (r.absence === undefined || r.absence.unavailable === undefined),
    )
    const bySurface: Record<string, string[]> = {}
    for (const region of exempt) (bySurface[region.surface] ??= []).push(region.id)

    expect(
      exempt.length,
      `${String(exempt.length)} reading regions are exempt from P5b (ceiling ${String(P5B_EXEMPT_CEILING)}) — ` +
        `a region with no 'unavailable' arm may fall back to its pre-run or stopped sentence after a real run ` +
        `and P5b will not call it a survivor. The set: ` +
        Object.entries(bySurface)
          .map(([surface, ids]) => `${surface} ${String(ids.length)} (${ids.join(', ')})`)
          .join(' · ') +
        `. Give the new region an 'unavailable' sentence, or raise ${String(P5B_EXEMPT_CEILING)} deliberately and say why.`,
    ).toBeLessThanOrEqual(P5B_EXEMPT_CEILING)
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
    // How many catalogue entries this property actually looked at, out of the catalogue's
    // whole length. Reported because "P1b is on for this surface" is a claim about a
    // COUNT, and a property that skipped every entry would report no problems at all.
    let examined = 0
    for (const region of REGIONS) {
      if (!WIRED_SURFACES.includes(region.surface)) continue
      // UI-SPEC section 4.1: with no node the bar is not rendered at all, so its regions
      // having no element IS their reading.
      if (region.absenceMode === 'element-removed' && !snapshot.barVisible) continue
      examined += 1
      const found = counts.get(region.id) ?? 0
      if (found !== 1) {
        problems.push(
          `${region.id} (${region.kind}) resolves to ${found} element(s); a wired surface's region is exactly one`,
        )
      }
    }
    process.stderr.write(
      `[P1b] examined ${examined} of ${REGIONS.length} catalogue entries ` +
        `(wired: ${WIRED_SURFACES.join(', ')}; #bar ${snapshot.barVisible ? 'visible' : 'absent'})\n`,
    )
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

  // P6, P7 and P8 are `./demo-region-properties.ts`'s, called here and called again against a
  // real two-tab run in `demo-liveness.e2e.test.ts`. On this page nothing is populated, so all
  // three examine zero regions — which is asserted below rather than reported as a pass.
  it('P6 — a populated figure also occurs in its own surface text view', () => {
    const result = p6(snapshot.regions)
    expect(result.problems).toEqual([])
    // Vacuity, stated as a measurement. This page has no node, so it stays 0 here forever;
    // `demo-liveness.e2e.test.ts` asserts the same function examined more than nothing.
    expect(result.examined).toBe(0)
  })

  it('P7 — a withheld count never appears without the sentence that explains it', () => {
    const result = p7(snapshot.regions)
    expect(result.problems).toEqual([])
    expect(result.examined).toBe(0)
  })

  it("P8 — an attestation region carries the fabric's own words and no sentence of the page's", () => {
    const result = p8(snapshot.regions, snapshot.attestationHook)
    expect(result.hookProblem).toBeNull()
    expect(result.problems).toEqual([])
    expect(result.examined).toBe(0)
  })
})
