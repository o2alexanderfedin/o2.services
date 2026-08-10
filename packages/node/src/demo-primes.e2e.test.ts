import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DIGIT, REGIONS } from '../../browser/src/demo-regions.ts'
import type { Region } from '../../browser/src/demo-regions.ts'
import { NO_DISPATCH_PATH, STATED_WEAKNESS } from '../../browser/demo/surfaces/primes.ts'
import type { DomRegion } from './demo-region-properties.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * **The Primes surface, asserted as what it is: an absence — and G4's open half, measured.**
 *
 * Plan 27-06, UI-SPEC sections 4.3 and 10. Two describes, and they are two different kinds of
 * check on purpose.
 *
 * # 1. The surface, driven in a browser
 *
 * The claim under test is negative in three ways at once, and a negative claim is the easiest
 * kind to satisfy by accident — a page that renders nothing satisfies most of it. So each arm
 * carries its own floor:
 *
 * - **No run control.** Not a disabled one either. UI-SPEC section 4.3 calls a disabled control
 *   with no explanation *a placeholder wearing a different hat*, and section 10 refuses to
 *   specify a control that produces **refusals discovered as timeouts**. The count is asserted
 *   at zero and the count of controls on a surface that HAS one is asserted beside it, so a
 *   selector that has stopped matching anything cannot pass this as a clean zero.
 * - **Every reading at its unavailable sentence, in every state the page can be in.** Before
 *   any node, with a node running, and after a colouring run on a *different* surface. That
 *   third state is the one with teeth: a primes reading that changed when the colouring ladder
 *   ran would mean it is wired to something it must not be wired to.
 * - **`window.o2` has no `runPrimes`.** The inverting guard. It is asserted here as well as in
 *   `demo-regions.e2e.test.ts`'s P4b because this file is the one a reader opens when asking
 *   *why is this surface empty* — and the answer must redden, here, the day the answer changes.
 *
 * # 2. The measurement, which needs no browser
 *
 * **This is G4's remaining half, measured from the demo's side.** The v1.1 audit's amended G4
 * row records that `buildPrimesInput`, `primesKernelBytes`, `projectPrimeCount`,
 * `readPrimeCount` and `PRIME_COUNT_KEY` have **zero production callers**, by grep over
 * `packages/` and `tools/` with tests excluded. Plan 27-06 ships the Primes surface and calls
 * none of them, so the row is still true after this surface exists.
 *
 * **It is expected to pass today and it is expected to FAIL the day somebody wires the primes
 * workload** — at which point this surface has stopped being honest and must be replanned. A
 * guard whose purpose is to notice a gap *closing* is worth more than a sentence saying the gap
 * is open, and this is the difference between recording a finding and quoting one: the audit's
 * numbers are re-measured here from the tree rather than transcribed.
 *
 * It does **not** duplicate `requirements-ledger.node.test.ts`, which reddens a ledger row
 * naming a symbol that has since acquired a caller. That guard is about the ledger's honesty;
 * this one is about the surface's. They measure the same fact from opposite ends and either can
 * outlive the other.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** The five symbols whose zero production callers ARE G4's open half. */
const PRIMES_SYMBOLS: readonly string[] = [
  'buildPrimesInput',
  'primesKernelBytes',
  'projectPrimeCount',
  'readPrimeCount',
  'PRIME_COUNT_KEY',
]

/**
 * The failure text the inverting guard must produce, named once so both places that assert it
 * say the same thing to whoever reads the red.
 */
const OPTION_A_HAS_LANDED =
  'the dispatch path this surface was told it does not have now exists — Option A has become ' +
  'available and the Primes surface must be replanned'

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((r) => [r.id, r]))

/** Every catalogue `reading` on the Primes surface, derived rather than listed. */
const PRIMES_READINGS: readonly Region[] = REGIONS.filter(
  (region) => region.surface === 'primes' && region.kind === 'reading',
)

// =========================================================================================
// 1. The surface, in a browser.
// =========================================================================================

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let workdir: string
let base = ''

/** One reading of the whole `#s-primes` panel, in one of the three states. */
interface PanelReading {
  readonly state: string
  readonly regions: readonly DomRegion[]
  readonly absencePanel: string
  readonly weaknessPanel: string
  readonly primaryControls: number
  readonly anyControls: number
  readonly colouringPrimaryControls: number
  readonly o2Keys: readonly string[]
}

async function readPrimesPanel(state: string): Promise<PanelReading> {
  const reading = await page.evaluate(() => {
    const panel = document.getElementById('s-primes')
    const regions = Array.from(panel?.querySelectorAll('[data-region]') ?? []).map((element) => ({
      id: element.getAttribute('data-region') ?? '',
      kind: element.getAttribute('data-kind'),
      source: element.getAttribute('data-source'),
      text: (element.textContent ?? '').trim(),
      outer: element.outerHTML.slice(0, 240),
    }))
    return {
      regions,
      absencePanel: (document.getElementById('primes-absence')?.textContent ?? '').trim(),
      weaknessPanel: (document.getElementById('primes-weakness')?.textContent ?? '').trim(),
      // `.btn-primary` is the selector P5 discovers run controls with, so this is the same
      // question P5 asks, asked of this surface directly.
      primaryControls: panel?.querySelectorAll('.btn-primary').length ?? -1,
      // EVERY button, including a disabled one and including one wearing another class. The
      // rule is not "no enabled primary control", it is "no run control".
      anyControls: panel?.querySelectorAll('button').length ?? -1,
      // The floor: the same selector against a surface that HAS a control. A zero that comes
      // from a selector matching nothing anywhere is not a reading about this surface.
      colouringPrimaryControls:
        document.getElementById('s-colouring')?.querySelectorAll('.btn-primary').length ?? -1,
      o2Keys: Object.keys(window.o2),
    }
  })
  return { state, ...reading }
}

/** Print every region verbatim. 27-05's lesson: read them off the screen, never infer them. */
function reportPanel(reading: PanelReading): void {
  process.stderr.write(`\n[primes · ${reading.state}] ${reading.regions.length} region(s)\n`)
  for (const region of reading.regions) {
    process.stderr.write(`  ${region.id} (${region.kind ?? '?'}): ${region.text.replace(/\n/g, ' ⏎ ')}\n`)
  }
}

const readings: PanelReading[] = []

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-demo-primes-'))
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 8,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  base = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
  context = await browser.newContext()
  page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[page error] ${error.message}\n`)
  })

  await page.goto(`${base}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: the harness consents by pressing the button.
  await page.click('#allow')
  await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
  // Navigate the visitor's own way — press the tab, which writes `location.hash`. `nav.ts`
  // hides every panel but the selected one, and a `hidden` panel's regions are still readable
  // through `textContent`; the click is here so a human watching the run sees what is asserted.
  await page.click('#nav-primes')
  await page.waitForSelector('#s-primes', { state: 'visible', timeout: 30_000 })

  // ---- state one: no node has ever existed in this tab ----
  readings.push(await readPrimesPanel('before any node'))

  // ---- state two: a node is running ----
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
  readings.push(await readPrimesPanel('with a node running'))

  // ---- state three: a colouring run finished on a DIFFERENT surface ----
  //
  // The arm with teeth. A primes reading that moves when the colouring ladder runs is wired to
  // something it must not be wired to, and nothing else in this suite would notice: P5 does not
  // collect regions from surfaces it did not drive, and it does not drive this one.
  await page.click('#nav-colouring')
  await page.waitForSelector('#s-colouring', { state: 'visible', timeout: 30_000 })
  const runReportBefore = (await page.textContent('#run-report')) ?? ''
  await page.click('#run')
  await page.waitForFunction(
    (was) => (document.getElementById('run-report')?.textContent ?? '') !== was,
    runReportBefore,
    { timeout: 600_000 },
  )
  await page.click('#nav-primes')
  await page.waitForSelector('#s-primes', { state: 'visible', timeout: 30_000 })
  readings.push(await readPrimesPanel('after a colouring run on another surface'))

  for (const reading of readings) reportPanel(reading)
}, 420_000)

afterAll(async () => {
  await page?.evaluate(async () => window.o2.stop()).catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('the Primes surface — a named absence, on a real page', () => {
  it('took a reading in all three states, and each one saw all twelve regions', () => {
    expect(readings.map((r) => r.state)).toEqual([
      'before any node',
      'with a node running',
      'after a colouring run on another surface',
    ])
    for (const reading of readings) {
      // Twelve declared plus `primes/report`, the surface's one text view. The text view is
      // not among UI-SPEC's twelve and is not counted in the catalogue's tally of ninety-one.
      expect(reading.regions.length, `${reading.state}: region count on #s-primes`).toBe(13)
    }
  })

  it('carries no run control at all — not a disabled one, and not one wearing another class', () => {
    for (const reading of readings) {
      // The floor first. A zero produced by a selector that matches nothing anywhere is not a
      // reading about this surface, and this is the same selector P5 discovers controls with.
      expect(
        reading.colouringPrimaryControls,
        `${reading.state}: the .btn-primary selector matched nothing on the colouring surface either, so the zero below measures the selector rather than the Primes surface`,
      ).toBeGreaterThan(0)

      expect(
        reading.primaryControls,
        `${reading.state}: #s-primes offers a primary run control. UI-SPEC section 10 refuses to specify one, because every executor refuses this module for a provenance failure and the control would produce a refusal discovered as a timeout`,
      ).toBe(0)
      expect(
        reading.anyControls,
        `${reading.state}: #s-primes offers a button. A disabled control with no explanation is a placeholder wearing a different hat, so the surface carries none at all`,
      ).toBe(0)
    }
  })

  it('states the absence in the interface contract’s own words, as prose and not as an error', () => {
    for (const reading of readings) {
      expect(reading.absencePanel, `${reading.state}: the section 4.3 panel`).toBe(NO_DISPATCH_PATH)
      expect(reading.weaknessPanel, `${reading.state}: the stated-weakness panel`).toBe(
        STATED_WEAKNESS,
      )
      // The sentence a visitor has to be able to find. Asserted as a substring of the panel
      // rather than only as an equality, so a reworded panel that keeps the claim still passes
      // and a panel that keeps the words while losing the claim does not.
      expect(reading.absencePanel).toContain('no dispatch path from a browser tab')
      expect(reading.absencePanel).toContain('nothing on this screen is a reading from your tab')
    }
  })

  it('renders every reading at its unavailable sentence, in all three states, digit-free', () => {
    const problems: string[] = []
    for (const reading of readings) {
      for (const region of PRIMES_READINGS) {
        const dom = reading.regions.find((entry) => entry.id === region.id)
        if (dom === undefined) {
          problems.push(`${reading.state}: ${region.id} has no element on the page`)
          continue
        }
        // From the COMMITTED CATALOGUE. Never `dom.getAttribute('data-absence')`: the writer
        // sets the attribute and the text in one call, so that comparison could not fail.
        const expected = region.absence?.unavailable
        if (expected === undefined) {
          problems.push(`${region.id}: the catalogue holds no unavailable sentence`)
          continue
        }
        if (dom.text !== expected) {
          problems.push(
            `${reading.state}: ${region.id} reads "${dom.text}" — the catalogue's unavailable sentence is "${expected}"`,
          )
        }
        if (DIGIT.test(dom.text)) {
          problems.push(
            `${reading.state}: ${region.id} is a reading with no reading and it carries a digit — "${dom.text}"`,
          )
        }
      }
    }
    expect(problems).toEqual([])
    // The floor. Eight readings across three states is twenty-four comparisons; a refactor that
    // empties `PRIMES_READINGS` must redden rather than pass over nothing.
    expect(PRIMES_READINGS.length, 'the catalogue lists no primes readings at all').toBe(8)
  })

  it('does not move when a run finishes on a different surface', () => {
    const [beforeNode, withNode, afterColouring] = readings as [
      PanelReading,
      PanelReading,
      PanelReading,
    ]
    // The colouring run really happened — otherwise the comparison below is between two
    // readings of an idle page and proves nothing.
    expect(
      afterColouring.o2Keys.length,
      'window.o2 lost its methods between readings',
    ).toBeGreaterThan(20)

    const digest = (reading: PanelReading): string =>
      reading.regions
        .filter((entry) => entry.kind === 'reading')
        .map((entry) => `${entry.id}|${entry.text}`)
        .join('\n')

    expect(digest(withNode), 'a primes reading changed when a node started').toBe(
      digest(beforeNode),
    )
    expect(
      digest(afterColouring),
      'a primes reading changed when the COLOURING ladder ran — this surface is wired to a run it must not be wired to',
    ).toBe(digest(beforeNode))
  })

  it('shows the published oracle as cited, with its provenance inside the same region', () => {
    const reading = readings[0] as PanelReading
    const oracle = reading.regions.find((entry) => entry.id === 'primes/oracle-table')
    expect(oracle, 'primes/oracle-table has no element').toBeDefined()
    expect(oracle?.kind).toBe('cited')
    // The figures and the statement of where they came from are ONE region, for the reason
    // UI-SPEC section 5.2 makes about the egress count: a figure that can be lifted out of the
    // page without its provenance will be.
    expect(oracle?.text).toContain('Published in the mathematical literature; not computed here.')
    expect(oracle?.text).toContain('It was not this tab')
    expect(oracle?.text).toContain('docs/perf/prime-and-pi-benchmarks.md')
    // Four published counts, transcribed from the committed document.
    for (const count of ['1229', '9592', '78498', '664579']) {
      expect(oracle?.text, `the published count ${count} is not on screen`).toContain(count)
    }

    const constant = reading.regions.find((entry) => entry.id === 'primes/max-n')
    expect(constant?.kind).toBe('constant')
    // The symbol travels beside the value, so the claim is checkable without reading the page's
    // source.
    expect(constant?.text).toContain('@o2/demo.PRIME_MAX_N')
  })

  it('renders both views out of one record — #primes-report carries what the cards carry', () => {
    const reading = readings[0] as PanelReading
    const view = reading.regions.find((entry) => entry.id === 'primes/report')
    expect(view, 'the surface declares no text view').toBeDefined()
    const text = view?.text ?? ''
    expect(text.length, '#primes-report is empty').toBeGreaterThan(200)
    // UI-SPEC section 2.2, the same property P6 holds generically: neither view may format
    // anything the other does not have. Quantified over every region on the surface but the
    // text view itself.
    const missing = reading.regions
      .filter((entry) => entry.id !== 'primes/report' && entry.kind !== 'prose')
      .filter((entry) => entry.text !== '' && !text.includes(entry.text))
      .map((entry) => `${entry.id}: "${entry.text.slice(0, 60)}…" is on a card and not in #primes-report`)
    expect(missing).toEqual([])
  })

  it('P4, inverted — window.o2 has no runPrimes, and the day it does this surface is replanned', () => {
    for (const reading of readings) {
      expect(reading.o2Keys.length, 'window.o2 has almost no methods, so the absence below is vacuous').toBeGreaterThan(20)
      expect(reading.o2Keys, `${reading.state}: ${OPTION_A_HAS_LANDED}`).not.toContain('runPrimes')
    }
    // And every permanently-unavailable primes reading names it, which is what makes the
    // assertion above a claim about this surface rather than a fact about a string.
    const naming = PRIMES_READINGS.filter((region) => region.source.includes('runPrimes(')).map(
      (region) => region.id,
    )
    expect(
      naming.length,
      'no primes reading names TabApi.runPrimes(), so the inverted guard above is quantified over nothing',
    ).toBeGreaterThanOrEqual(7)
    for (const id of naming) {
      expect(CATALOGUE.get(id)?.permanentlyUnavailable).toBeDefined()
    }
  })
})

// =========================================================================================
// 2. The measurement — G4's remaining half, from the demo's side. No browser.
// =========================================================================================

/**
 * Every `*.ts` under a directory, excluding tests and everything that is not source.
 *
 * `dist` and `node_modules` are skipped because neither is written by hand: a match in a build
 * output is a match in a copy of a file already counted, and it would make the file set depend
 * on whether somebody had run a build.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out)
      continue
    }
    if (!entry.endsWith('.ts')) continue
    if (/\.(?:test|node\.test|browser\.test|e2e\.test|perf\.test)\.ts$/.test(entry)) continue
    out.push(path)
  }
  return out
}

/**
 * Is this line a comment?
 *
 * Line-based, and its limit is stated rather than left to be found: a symbol named on a code
 * line *inside* a block comment whose continuation lines do not begin with `*` would be
 * misclassified as code, and would therefore make this guard red rather than green. That is the
 * safe direction to be wrong in — a false red is investigated, a false green is not — and every
 * block comment in this repository is `*`-prefixed anyway.
 */
function isComment(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  )
}

interface SymbolMatch {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly comment: boolean
}

function measurePrimesSymbols(): readonly SymbolMatch[] {
  const pattern = new RegExp(`\\b(?:${PRIMES_SYMBOLS.join('|')})\\b`)
  const matches: SymbolMatch[] = []
  for (const root of ['packages', 'tools']) {
    for (const path of sourceFiles(join(ROOT, root))) {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((text, index) => {
        if (!pattern.test(text)) return
        matches.push({
          file: relative(ROOT, path),
          line: index + 1,
          text: text.trim(),
          comment: isComment(text),
        })
      })
    }
  }
  return matches
}

/**
 * Every file that mentions one of the five symbols at all, comments included, with why.
 *
 * **Adding a file here is the whole alarm.** A new entry means somebody has touched the primes
 * workload, and whoever does must decide in this file whether the Primes surface is still
 * telling the truth. The set is asserted rather than the count, so the red names the file.
 */
const EXPECTED_MENTIONS: Readonly<Record<string, string>> = {
  'packages/demo/src/primes.ts': 'the module itself — every one of the five is defined here',
  'packages/demo/src/index.ts': "the barrel's re-export, which is not a call",
  'packages/demo/src/pi.ts': "one doc comment contrasting pi's signed read with readPrimeCount",
  'packages/browser/src/demo-regions.ts':
    "the catalogue's Option B decision block, citing why runJob cannot carry buildPrimesInput",
  'packages/browser/demo/surfaces/primes.ts':
    "this surface's own header, citing UI-SPEC section 10's three measured facts",
}

/**
 * Every file that mentions one on a **code** line. These, and only these, may exist.
 *
 * A definition and a re-export. Neither is a caller, which is precisely the audit's finding:
 * *zero production callers*. A third entry here is Option A having landed.
 */
const EXPECTED_CODE: readonly string[] = ['packages/demo/src/index.ts', 'packages/demo/src/primes.ts']

describe("G4's remaining half, measured — the five primes symbols have no production caller", () => {
  it('matches only the files this plan expects, and names any file that has joined them', () => {
    const matches = measurePrimesSymbols()
    const files = [...new Set(matches.map((match) => match.file))].sort()

    process.stderr.write(
      `\n[G4·primes] ${matches.length} match(es) of ${PRIMES_SYMBOLS.length} symbols across ` +
        `${files.length} file(s), over packages/ and tools/, tests excluded:\n`,
    )
    for (const file of files) {
      const inFile = matches.filter((match) => match.file === file)
      const code = inFile.filter((match) => !match.comment).length
      process.stderr.write(
        `  ${file}: ${inFile.length} match(es), ${code} on a code line — ` +
          `${EXPECTED_MENTIONS[file] ?? '**UNEXPECTED**'}\n`,
      )
    }

    expect(
      files,
      'a file outside the expected set names one of the five primes symbols. If that file CALLS one, G4’s primes half has been closed and the Primes surface — which tells a visitor this workload has no dispatch path from a tab — is no longer honest and must be replanned',
    ).toEqual(Object.keys(EXPECTED_MENTIONS).sort())
  })

  it('finds the five symbols on a code line in the module and the barrel, and nowhere else', () => {
    const matches = measurePrimesSymbols()
    const code = matches.filter((match) => !match.comment)
    const files = [...new Set(code.map((match) => match.file))].sort()

    const offenders = code
      .filter((match) => !EXPECTED_CODE.includes(match.file))
      .map((match) => `${match.file}:${match.line}  ${match.text}`)

    process.stderr.write(
      `[G4·primes] ${code.length} code-line match(es) in ${files.length} file(s): ${files.join(', ')}\n` +
        `[G4·primes] production callers: ${offenders.length}\n`,
    )

    expect(
      offenders,
      'a production caller of the primes workload now exists. This is G4’s primes half closing, which is good news and a red here on purpose: the Primes surface ships as Option B — a named absence — and a workload with a caller is no longer absent. Replan the surface before making this green',
    ).toEqual([])
    expect(files, 'the module and the barrel must both still be found').toEqual([...EXPECTED_CODE])
  })

  it('is not vacuous — the symbols exist, and the search really reaches the tree', () => {
    // A guard over an empty match set is the failure mode it exists to prevent, one level up.
    const matches = measurePrimesSymbols()
    expect(matches.length, 'the search found nothing at all, so both assertions above are vacuous').toBeGreaterThan(5)
    const definitions = matches.filter((match) => match.file === 'packages/demo/src/primes.ts')
    for (const symbol of PRIMES_SYMBOLS) {
      expect(
        definitions.some((match) => match.text.includes(symbol)),
        `${symbol} is not defined in packages/demo/src/primes.ts — the symbol list has gone stale`,
      ).toBe(true)
    }
    // And the walker really walks: `tools/` and `packages/` both hold source it must have seen.
    expect(sourceFiles(join(ROOT, 'packages')).length).toBeGreaterThan(50)
    expect(sourceFiles(join(ROOT, 'tools')).length).toBeGreaterThan(0)
  })
})
