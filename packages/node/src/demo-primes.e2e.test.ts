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
import {
  DISPATCH_INTENT,
  ORACLE,
  PRIMES_N,
  STATED_WEAKNESS,
} from '../../browser/demo/surfaces/primes.ts'
import type { DomRegion } from './demo-region-properties.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * **The Primes surface, driven — and audit finding G4's open half, closed and measured.**
 *
 * # This file used to assert the opposite, and that is the point of it
 *
 * Plan 27-06 shipped this surface under UI-SPEC section 10's **Option B** — *ship the absence* —
 * and this spec asserted the absence: no run control, every reading permanently at its
 * unavailable sentence, `window.o2` without `runPrimes`, and the five primes symbols with zero
 * production callers. Its header said, in those words, that it was **expected to FAIL the day
 * somebody wires the primes workload**, at which point the surface had stopped being honest and
 * had to be replanned.
 *
 * The owner took Option A on 2026-08-17. This spec went red exactly as designed, and this file
 * is the replan. **The mechanism worked and was not bypassed** — which is worth more than the
 * green either version produces, because a guard whose purpose is to notice a gap *closing* only
 * proves itself when the gap closes.
 *
 * # 1. The surface, driven in a browser
 *
 * Four states, and the last two carry the weight:
 *
 * - **Before any node**, and **with a node running** — every reading at its `initial` sentence,
 *   digit-free. A reading with no reading must not show a zero: a zero is a quantity that was
 *   never measured.
 * - **After a colouring run on a *different* surface.** The arm with teeth, kept from the Option
 *   B version unchanged. A primes reading that moved when the colouring ladder ran would be
 *   wired to something it must not be wired to, and nothing else in this suite would notice.
 * - **After a primes run.** The headline: the fabric's own count, taken in a browser, compared
 *   for **equality** against a value published in the mathematical literature. Not a tolerance —
 *   π(x) is an integer, and 10⁵ has exactly one right answer.
 *
 * ## Why the oracle is the strongest check on this page, and where it is blind
 *
 * `verifyColouring` re-derives the triples from the definition, which is strong, but it shares an
 * author with the fabric — a misconception held in both is invisible to the pair. The published
 * π(x) table does not have that weakness. It also has a stated blind spot, asserted on screen
 * here and closed elsewhere: published values sit at powers of ten, and a power of ten is far
 * from the prime below it, so a guest that silently lost the top of its range would return the
 * right total anyway. `primes-reduce.node.test.ts` is what closes that, by tiling `[2, N]` at
 * every shard count from one to eight. **This file does not re-derive it and must not be read as
 * if it did.**
 *
 * # 2. The measurement, which needs no browser
 *
 * The same grep the Option B version ran, with its expectations inverted. It measured that the
 * five primes symbols had **zero** production callers; it now measures that they have callers and
 * names every file holding one. The alarm points the other way and is just as loud: a file
 * leaving this set means the workload has been *un*wired, and this surface would be claiming a
 * run path it no longer has.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** The five symbols whose production callers ARE G4's primes half, closed. */
const PRIMES_SYMBOLS: readonly string[] = [
  'buildPrimesInput',
  'primesKernelBytes',
  'projectPrimeCount',
  'readPrimeCount',
  'PRIME_COUNT_KEY',
]

/**
 * The published count for the bound this page sends — read from the surface's own table.
 *
 * Derived rather than typed, so the spec and the page cannot come to disagree about which row of
 * the oracle applies. A bound with no published row is a configuration error in the page and is
 * failed loudly here rather than skipped, because the surface's whole claim is that its answer is
 * checkable against something this repository did not write.
 */
const PUBLISHED_COUNT: number = (() => {
  for (const [exponent, count] of ORACLE) {
    if (PRIMES_N === 10 ** exponent) return count
  }
  throw new Error(
    `the page sends N = ${PRIMES_N}, and the published oracle has no value at that bound — ` +
      'the comparison this surface exists for cannot be made',
  )
})()

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

/** One reading of the whole `#s-primes` panel, in one of the four states. */
interface PanelReading {
  readonly state: string
  readonly regions: readonly DomRegion[]
  readonly introPanel: string
  readonly weaknessPanel: string
  readonly primaryControls: number
  readonly anyControls: number
  readonly colouringPrimaryControls: number
  readonly o2Keys: readonly string[]
  /** `window.__o2LastPrimesRun`, the hook the run handler parks its reading on. */
  readonly lastRun: {
    readonly n: number
    readonly shards: number
    readonly total: number | null
    readonly complete: boolean
    readonly reduceAttempted: boolean
  } | null
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
    // Reached through an index rather than a declared property, following the idiom
    // `demo-pi.e2e.test.ts` established for `__o2LastPiRun`: the hook is a forcing function
    // the page installs for specs, not part of `TabApi`, and declaring it on `Window` would
    // put it in every consumer's types.
    const run = ((window as unknown as Record<string, unknown>)['__o2LastPrimesRun'] ?? null) as {
      n: number
      shards: number
      total: number | null
      complete: boolean
      reduceAttempted: boolean
    } | null
    return {
      regions,
      introPanel: (document.getElementById('primes-intro')?.textContent ?? '').trim(),
      weaknessPanel: (document.getElementById('primes-weakness')?.textContent ?? '').trim(),
      // `.btn-primary` is the selector P5 discovers run controls with, so this is the same
      // question P5 asks, asked of this surface directly.
      primaryControls: panel?.querySelectorAll('.btn-primary').length ?? -1,
      anyControls: panel?.querySelectorAll('button').length ?? -1,
      // The floor: the same selector against a surface that has always had a control.
      colouringPrimaryControls:
        document.getElementById('s-colouring')?.querySelectorAll('.btn-primary').length ?? -1,
      o2Keys: Object.keys(window.o2),
      lastRun:
        run === null
          ? null
          : {
              n: run.n,
              shards: run.shards,
              total: run.total,
              complete: run.complete,
              reduceAttempted: run.reduceAttempted,
            },
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

/** The three states in which no primes run has happened yet. */
function beforeRun(): readonly PanelReading[] {
  return readings.slice(0, 3)
}

/** The state after the run — the only one carrying a count. */
function afterRun(): PanelReading {
  const reading = readings[3]
  if (reading === undefined) throw new Error('the primes run reading was never taken')
  return reading
}

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
  // Navigate the visitor's own way — press the tab, which writes `location.hash`.
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
  // Kept from the Option B version unchanged. A primes reading that moves when the colouring
  // ladder runs is wired to something it must not be wired to, and nothing else in this suite
  // would notice: P5 does not collect regions from surfaces it did not drive.
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

  // ---- state four: the primes run itself ----
  //
  // Pressed the way a visitor presses it. `#primes-status` is the settle signal rather than a
  // fixed wait: the handler writes one of three terminal sentences, or `the run stopped`, and
  // waiting on the text means a failure arrives as a red assertion carrying the fabric's own
  // words instead of as a timeout that says nothing about why.
  await page.waitForFunction(
    () => document.getElementById('run-primes')?.hasAttribute('disabled') === false,
    null,
    { timeout: 60_000 },
  )
  await page.click('#run-primes')
  await page.waitForFunction(
    () => {
      const text = document.getElementById('primes-status')?.textContent ?? ''
      return text !== 'ready' && text !== 'dispatching…' && text !== 'start a node first'
    },
    null,
    { timeout: 600_000 },
  )
  readings.push(await readPrimesPanel('after a primes run'))

  for (const reading of readings) reportPanel(reading)
}, 600_000)

afterAll(async () => {
  await page?.evaluate(async () => window.o2.stop()).catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('the Primes surface — a workload a visitor can run', () => {
  it('took a reading in all four states, and each one saw all twelve regions', () => {
    expect(readings.map((r) => r.state)).toEqual([
      'before any node',
      'with a node running',
      'after a colouring run on another surface',
      'after a primes run',
    ])
    for (const reading of readings) {
      // Twelve declared plus `primes/report`, the surface's one text view. The text view is
      // not among UI-SPEC's twelve and is not counted in the catalogue's tally of ninety-one.
      expect(reading.regions.length, `${reading.state}: region count on #s-primes`).toBe(13)
    }
  })

  it('carries exactly one run control, where under Option B it carried none at all', () => {
    for (const reading of readings) {
      // The floor first, unchanged from the Option B version: a count produced by a selector
      // that matches nothing anywhere is not a reading about this surface.
      expect(
        reading.colouringPrimaryControls,
        `${reading.state}: the .btn-primary selector matched nothing on the colouring surface either, so the count below measures the selector rather than the Primes surface`,
      ).toBeGreaterThan(0)

      expect(
        reading.primaryControls,
        `${reading.state}: #s-primes must offer exactly one primary run control. This assertion read \`.toBe(0)\` until 2026-08-17, when Option A gave the workload a signed record and a dispatch path`,
      ).toBe(1)
      expect(reading.anyControls, `${reading.state}: buttons on #s-primes`).toBe(1)
    }
  })

  it('states what the workload is checked against, as prose and not as an error', () => {
    for (const reading of readings) {
      expect(reading.introPanel, `${reading.state}: the section 4.3 panel`).toBe(DISPATCH_INTENT)
      expect(reading.weaknessPanel, `${reading.state}: the stated-weakness panel`).toBe(
        STATED_WEAKNESS,
      )
      // The claims a visitor has to be able to find, asserted as substrings as well as by
      // equality: a reworded panel keeping the claim still passes, and a panel keeping the
      // words while losing the claim does not.
      expect(reading.introPanel).toContain('an equality and not a tolerance')
      expect(reading.introPanel).toContain('before this repository existed')
      // The blind spot is still stated. Option A gave the oracle something to check and did
      // nothing whatever about the direction in which it is blind, and the page must not have
      // quietly dropped the sentence that says so.
      expect(reading.weaknessPanel).toContain('blind in one direction')
    }
  })

  it('shows every reading at a named absence before a run, digit-free', () => {
    // **The arm compared against is `stopped`, and that is the page's behaviour rather than
    // this surface's.** `index.html` calls `paintSurfaceAbsence(<surface>, 'stopped')` once at
    // boot for session, colouring, pi, primes and byo alike, and nothing repaints a reading when
    // a node starts — only a run does. So an unrun surface reads *"this tab's node is stopped"*
    // even with a live node, on all five. That is a page-wide copy question, it predates this
    // work, and it is not fixed here: what is asserted is that primes behaves exactly as its
    // four siblings do, from the committed catalogue.
    const problems: string[] = []
    for (const reading of beforeRun()) {
      for (const region of PRIMES_READINGS) {
        const dom = reading.regions.find((entry) => entry.id === region.id)
        if (dom === undefined) {
          problems.push(`${reading.state}: ${region.id} has no element on the page`)
          continue
        }
        // From the COMMITTED CATALOGUE. Never `dom.getAttribute('data-absence')`: the writer
        // sets the attribute and the text in one call, so that comparison could not fail.
        //
        // `permanentlyUnavailable` regions take their `unavailable` arm whatever the state is —
        // `render.ts` says so — and N9 is the one that still carries it.
        const expected =
          region.permanentlyUnavailable === undefined
            ? region.absence?.stopped
            : region.absence?.unavailable
        if (expected === undefined) {
          problems.push(`${region.id}: the catalogue holds no sentence for this state`)
          continue
        }
        if (dom.text !== expected) {
          problems.push(
            `${reading.state}: ${region.id} reads "${dom.text}" — the catalogue's sentence is "${expected}"`,
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
    const [beforeNode, withNode, afterColouring] = beforeRun() as [
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
    // And the paired positive: the primes run DOES move them. Without this, a surface whose
    // regions never change would satisfy both assertions above perfectly.
    expect(
      digest(afterRun()),
      'the primes run left every reading exactly as it was, so this surface is wired to nothing at all',
    ).not.toBe(digest(beforeNode))
  })

  it('counts the primes below the published bound and agrees with the tabulated value', () => {
    const reading = afterRun()

    // The run really happened, and it is this tab's own reading rather than the page's — the
    // forcing function `window.__o2LastPiRun` provides one surface over. *The right value read
    // from the wrong object* is the divergence class this repository's ledger records against
    // this tier, so the hook and the screen are both asserted and compared.
    const run = reading.lastRun
    expect(run, 'the page parked no primes run on window.__o2LastPrimesRun').not.toBeNull()
    if (run === null) return
    expect(run.n, 'the run used a bound other than the one the surface publishes').toBe(PRIMES_N)
    expect(run.shards, 'a run over no shards is not a distributed run').toBeGreaterThan(0)
    expect(run.complete, 'the map half did not complete — some shard never reached agreement').toBe(
      true,
    )

    process.stderr.write(
      `\n[primes·oracle] N = ${PRIMES_N}, shards = ${run.shards}, ` +
        `fabric counted ${String(run.total)}, published value ${PUBLISHED_COUNT}\n`,
    )

    // **The claim.** An equality against a number nobody here produced.
    expect(
      run.total,
      `the fabric counted ${String(run.total)} primes below ${PRIMES_N}; the value published in the mathematical literature is ${PUBLISHED_COUNT}`,
    ).toBe(PUBLISHED_COUNT)

    // And the screen says so, in the region UI-SPEC gives the comparison. Read off the page
    // rather than off the object, because a correct answer displayed nowhere is not a surface.
    const total = reading.regions.find((entry) => entry.id === 'primes/total')
    expect(total?.text, 'primes/total does not show the count').toBe(String(PUBLISHED_COUNT))

    const compare = reading.regions.find((entry) => entry.id === 'primes/oracle-compare')
    expect(compare?.text, 'primes/oracle-compare shows no verdict').toContain('agrees')
    // Both operands on screen, which is UI-SPEC's requirement for this row: a reader checks
    // the claim rather than trusting the word "agrees".
    expect(compare?.text).toContain(String(PUBLISHED_COUNT))
    expect(compare?.text).toContain(String(PRIMES_N))
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
    // Taken after the run, which is the harder arm: under Option B every region held the same
    // permanent sentence, so the two views agreeing said very little.
    const reading = afterRun()
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

  it('P4, no longer inverted — window.o2 has runPrimes, and every reading names it', () => {
    for (const reading of readings) {
      expect(
        reading.o2Keys.length,
        'window.o2 has almost no methods, so the assertion below is vacuous',
      ).toBeGreaterThan(20)
      // **This assertion read `.not.toContain` until 2026-08-17.** It was written so that the
      // day Option A landed it would redden and force this surface back onto the board rather
      // than let it stay quietly absent. It did. This is the replan, not a relaxation.
      expect(
        reading.o2Keys,
        `${reading.state}: window.o2 has no runPrimes, so the Primes surface names a dispatch path it does not have`,
      ).toContain('runPrimes')
    }
    // And every primes reading still names it, which is what makes the assertion above a claim
    // about this surface rather than a fact about a string.
    const naming = PRIMES_READINGS.filter((region) => region.source.includes('runPrimes(')).map(
      (region) => region.id,
    )
    expect(
      naming.length,
      'no primes reading names TabApi.runPrimes(), so the guard above is quantified over nothing',
    ).toBeGreaterThanOrEqual(7)
    // N9 is the one reading that is STILL permanently unavailable, and it is the only one.
    // `TabPrimesRun` carries the total and not the shard rows — as true after Option A as
    // before it. Wiring a workload does not turn every absence on its surface into a reading.
    const permanent = PRIMES_READINGS.filter(
      (region) => CATALOGUE.get(region.id)?.permanentlyUnavailable !== undefined,
    ).map((region) => region.id)
    expect(permanent).toEqual(['primes/per-shard'])
  })
})

// =========================================================================================
// 2. The measurement — G4's primes half, closed. No browser.
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
 * misclassified as code. Under Option B that was the safe direction to be wrong in, because it
 * produced a false red. **Under Option A it is the unsafe direction**, since a misclassified
 * comment now counts as a caller — so the code-line set is asserted as an exact set below rather
 * than as a count, and every entry is named.
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
 * Every file that mentions one of the five symbols on a **code** line — the production callers.
 *
 * **This set was two entries and neither was a caller.** Under Option B it held only
 * `primes.ts` (the definitions) and `index.ts` (the re-export), which is exactly what *zero
 * production callers* means, and a third entry was defined as Option A having landed.
 *
 * It landed. `demo/main.ts` is the caller — `runPrimes` builds the input, names the record and
 * projects the partial — and `scripts/sign-kernel.ts` is what mints the record that lets it run
 * at all. A file **leaving** this set is now the alarm: it would mean the workload has been
 * un-wired while the surface still offers a control for it.
 */
const EXPECTED_CODE: Readonly<Record<string, string>> = {
  'packages/demo/src/primes.ts': 'the module itself — every one of the five is defined here',
  'packages/demo/src/index.ts': "the barrel's re-export, which is not a call",
  'packages/demo/scripts/sign-kernel.ts':
    'signs primes.wasm into PRIMES_RECORD — the record whose absence WAS G4’s primes half',
  'packages/browser/demo/main.ts':
    'TabApi.runPrimes — the production caller, and the closing of G4’s primes half',
}

describe("G4's primes half, measured — the workload has a production caller", () => {
  it('names every file that calls one of the five symbols, and admits no other', () => {
    const matches = measurePrimesSymbols()
    const code = matches.filter((match) => !match.comment)
    const files = [...new Set(code.map((match) => match.file))].sort()

    process.stderr.write(
      `\n[G4·primes] ${matches.length} match(es) of ${PRIMES_SYMBOLS.length} symbols across ` +
        `${new Set(matches.map((m) => m.file)).size} file(s), ${code.length} on a code line:\n`,
    )
    for (const file of files) {
      const inFile = code.filter((match) => match.file === file)
      process.stderr.write(
        `  ${file}: ${inFile.length} code-line match(es) — ${EXPECTED_CODE[file] ?? '**UNEXPECTED**'}\n`,
      )
    }

    expect(
      files,
      'the set of files calling the primes workload has changed. A file LEAVING this set means the workload has been un-wired while the Primes surface still offers a run control for it — which is the Option B state with the honesty removed. A file JOINING it is ordinary and this entry should be added with a reason',
    ).toEqual(Object.keys(EXPECTED_CODE).sort())
  })

  it('finds the caller specifically — main.ts builds the input and projects the partial', () => {
    const code = measurePrimesSymbols().filter((match) => !match.comment)
    const inMain = code.filter((match) => match.file === 'packages/browser/demo/main.ts')

    // Not "main.ts mentions primes somewhere": the two symbols that make it a *caller* rather
    // than an importer are the input builder and the projection. An import line alone would
    // satisfy a file-level check and would mean the workload is still unreachable.
    const calls = inMain.filter(
      (match) => /buildPrimesInput\s*\(/.test(match.text) || /project:\s*projectPrimeCount/.test(match.text),
    )
    process.stderr.write(
      `[G4·primes] main.ts: ${inMain.length} code-line match(es), ${calls.length} of them a call:\n` +
        calls.map((match) => `  main.ts:${match.line}  ${match.text}`).join('\n') +
        '\n',
    )
    expect(
      calls.map((match) => match.line).length,
      'packages/browser/demo/main.ts names the primes symbols but calls none of them — the workload is imported and not dispatched',
    ).toBeGreaterThanOrEqual(2)
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
